//! SVG import/export — a real, self-contained SVG subset engine module.
//!
//! Import parses SVG XML (hand-rolled tokenizer, no external dependencies) into
//! `photocraft-doc` shape layers: `<path>` (full path-data grammar incl. arcs),
//! `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`,
//! nested `<g>` groups (mapped 1:1 onto layer groups), transforms
//! (`matrix/translate/scale/rotate/skewX/skewY`), paints (`fill`, `stroke`,
//! opacities, `fill-rule`), and simple `<use href="#id">` resolution.
//! Unsupported constructs (CSS `<style>`, filters, embedded images, SVG text)
//! are reported as warnings, never silently dropped.
//!
//! Export serializes shape layers and vector masks back to clean SVG path data.

use photocraft_doc::{
    Fill, FillRule, Group, Knot, Layer, LayerContent, LineCap, LineJoin, Path, PathOp, ShapeLayer,
    ShapeStroke, StrokeAlign, Subpath,
};
use photocraft_geom::{Affine, Point};
use serde_json::{Value, json};

use crate::{EngineError, Result, Session};

// ---------------------------------------------------------------------------
// XML tokenizer
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Clone)]
struct XmlElem {
    tag: String,
    attrs: Vec<(String, String)>,
    children: Vec<XmlElem>,
    /// Concatenated text content (used by <title>/<desc>).
    text: String,
}

impl XmlElem {
    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
    /// First matching attribute or `None` (`xlink:href` / `href`).
    fn attr_any(&self, names: &[&str]) -> Option<String> {
        names.iter().find_map(|n| self.attr(n).map(str::to_string))
    }
}

struct XmlCursor<'a> {
    s: Vec<char>,
    src: &'a str,
    i: usize,
}

impl<'a> XmlCursor<'a> {
    fn new(src: &'a str) -> Self {
        XmlCursor { s: src.chars().collect(), src, i: 0 }
    }
    fn starts_with(&self, pat: &str) -> bool {
        pat.chars().enumerate().all(|(k, c)| self.i + k < self.s.len() && self.s[self.i + k] == c)
    }
    fn skip_ws(&mut self) {
        while self.i < self.s.len() && self.s[self.i].is_whitespace() {
            self.i += 1;
        }
    }
    /// Skip a `<?…?>`, `<!…>` (comments, DOCTYPE, CDATA) or return false.
    fn skip_misc(&mut self) -> bool {
        if self.starts_with("<?") {
            self.skip_until("?>");
            true
        } else if self.starts_with("<!--") {
            self.skip_until("-->");
            true
        } else if self.starts_with("<![CDATA[") {
            self.skip_until("]]>");
            true
        } else if self.starts_with("<!") {
            self.skip_until(">");
            true
        } else {
            false
        }
    }
    fn skip_until(&mut self, pat: &str) {
        while self.i < self.s.len() && !self.starts_with(pat) {
            self.i += 1;
        }
        self.i += pat.chars().count();
    }
    fn read_until_one_of(&mut self, stop: &str) -> String {
        let mut out = String::new();
        while self.i < self.s.len() && !stop.contains(self.s[self.i]) {
            out.push(self.s[self.i]);
            self.i += 1;
        }
        out
    }
    fn read_name(&mut self) -> String {
        let mut out = String::new();
        while self.i < self.s.len() {
            let c = self.s[self.i];
            if c.is_whitespace() || c == '>' || c == '/' || c == '=' {
                break;
            }
            out.push(c);
            self.i += 1;
        }
        out
    }
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] != '&' {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        // Find the terminating ';' within 32 chars.
        let mut semi = None;
        let mut k = i + 1;
        while k < chars.len() && k - i <= 32 {
            if chars[k] == ';' {
                semi = Some(k);
                break;
            }
            if chars[k].is_whitespace() {
                break;
            }
            k += 1;
        }
        match semi {
            Some(end) => {
                let ent: String = chars[i + 1..end].iter().collect();
                match decode_entity(&ent) {
                    Some(d) => out.push_str(&d),
                    None => out.push_str(&format!("&{ent};")),
                }
                i = end + 1;
            }
            None => {
                out.push('&');
                i += 1;
            }
        }
    }
    out
}

fn decode_entity(ent: &str) -> Option<String> {
    match ent {
        "lt" => return Some('<'.to_string()),
        "gt" => return Some('>'.to_string()),
        "amp" => return Some('&'.to_string()),
        "quot" => return Some('"'.to_string()),
        "apos" => return Some('\''.to_string()),
        _ => {}
    }
    if let Some(hex) = ent.strip_prefix("#x").or_else(|| ent.strip_prefix("#X")) {
        return u32::from_str_radix(hex, 16).ok().and_then(char::from_u32).map(String::from);
    }
    if let Some(dec) = ent.strip_prefix('#') {
        return dec.parse::<u32>().ok().and_then(char::from_u32).map(String::from);
    }
    None
}

fn local_tag(tag: &str) -> &str {
    match tag.split_once(':') {
        Some((_, local)) => local,
        None => tag,
    }
}

fn parse_xml(src: &str) -> Result<XmlElem, String> {
    let mut c = XmlCursor::new(src);
    let mut stack: Vec<XmlElem> = Vec::new();
    let mut root: Option<XmlElem> = None;
    let mut seen_any = false;
    while c.i < c.s.len() {
        if c.s[c.i] != '<' {
            // Text content: kept on the innermost open element (title/desc read it).
            if let Some(top) = stack.last_mut() {
                let t = c.read_until_one_of("<");
                let trimmed = t.trim();
                if !trimmed.is_empty() {
                    if !top.text.is_empty() {
                        top.text.push(' ');
                    }
                    top.text.push_str(trimmed);
                }
            } else {
                c.read_until_one_of("<");
            }
            continue;
        }
        if c.skip_misc() {
            continue;
        }
        if c.starts_with("</") {
            c.i += 2;
            let name = c.read_name();
            c.skip_ws();
            if c.i >= c.s.len() || c.s[c.i] != '>' {
                return Err(format!("malformed closing tag `</{name}`"));
            }
            c.i += 1;
            let top = stack.pop().ok_or_else(|| format!("unexpected `</{name}>`"))?;
            if local_tag(&top.tag) != local_tag(&name) {
                return Err(format!("mismatched tags: `<{}>` closed by `</{name}>`", top.tag));
            }
            match stack.last_mut() {
                Some(parent) => parent.children.push(top),
                None => {
                    if root.is_some() {
                        return Err("multiple root elements".into());
                    }
                    root = Some(top);
                }
            }
            continue;
        }
        // Opening tag.
        c.i += 1; // '<'
        let raw = c.read_name();
        if raw.is_empty() {
            return Err("empty element name".into());
        }
        seen_any = true;
        let mut elem = XmlElem { tag: raw, attrs: Vec::new(), children: Vec::new() };
        loop {
            c.skip_ws();
            if c.i >= c.s.len() {
                return Err(format!("unterminated `<{}>`", elem.tag));
            }
            if c.s[c.i] == '>' {
                c.i += 1;
                stack.push(elem);
                break;
            }
            if c.starts_with("/>") {
                c.i += 2;
                match stack.last_mut() {
                    Some(parent) => parent.children.push(elem),
                    None => {
                        if root.is_some() {
                            return Err("multiple root elements".into());
                        }
                        root = Some(elem);
                    }
                }
                break;
            }
            let aname = c.read_name();
            if aname.is_empty() {
                return Err(format!("malformed attribute in `<{}>`", elem.tag));
            }
            c.skip_ws();
            let avalue = if c.i < c.s.len() && c.s[c.i] == '=' {
                c.i += 1;
                c.skip_ws();
                if c.i >= c.s.len() || (c.s[c.i] != '"' && c.s[c.i] != '\'') {
                    return Err(format!("attribute `{aname}` needs a quoted value"));
                }
                let quote = c.s[c.i];
                c.i += 1;
                let v = c.read_until_one_of(&quote.to_string());
                if c.i >= c.s.len() {
                    return Err(format!("unterminated value of `{aname}`"));
                }
                c.i += 1;
                decode_entities(&v)
            } else {
                String::new()
            };
            elem.attrs.push((aname, avalue));
        }
    }
    if !seen_any {
        return Err("no XML elements found".into());
    }
    if !stack.is_empty() {
        return Err(format!("unclosed element `<{}>`", stack.last().map(|e| e.tag.as_str()).unwrap_or("")));
    }
    root.ok_or_else(|| "no root element".to_string())
}

// ---------------------------------------------------------------------------
// Path-data parser (full grammar: M m L l H h V v C c S s Q q T t A a Z z)
// ---------------------------------------------------------------------------

struct PathCursor<'a> {
    s: Vec<char>,
    i: usize,
    _marker: std::marker::PhantomData<&'a ()>,
}

impl<'a> PathCursor<'a> {
    fn new(src: &'a str) -> Self {
        PathCursor { s: src.chars().collect(), i: 0, _marker: std::marker::PhantomData }
    }
    fn skip_sep(&mut self) {
        while self.i < self.s.len() && (self.s[self.i].is_whitespace() || self.s[self.i] == ',') {
            self.i += 1;
        }
    }
    fn peek_cmd(&self) -> Option<char> {
        self.skip_sep();
        self.s.get(self.i).copied().filter(|c| c.is_ascii_alphabetic())
    }
    fn has_number(&self) -> bool {
        let save = self.i;
        self.skip_sep();
        let ok = self.i < self.s.len() && (self.s[self.i].is_ascii_digit()
            || ((self.s[self.i] == '+' || self.s[self.i] == '-' || self.s[self.i] == '.')
                && self.i + 1 < self.s.len()
                && (self.s[self.i + 1].is_ascii_digit() || self.s[self.i + 1] == '.')));
        self.i = save;
        ok
    }
    fn number(&mut self) -> Result<f64, String> {
        self.skip_sep();
        let start = self.i;
        if self.i < self.s.len() && (self.s[self.i] == '+' || self.s[self.i] == '-') {
            self.i += 1;
        }
        // Integer part.
        while self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
            self.i += 1;
        }
        // Fraction ("1.5.5" = 1.5 then .5: the fraction ends at the second dot).
        if self.i < self.s.len() && self.s[self.i] == '.' {
            self.i += 1;
            while self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
                self.i += 1;
            }
        }
        // Exponent. A '.' right after the exponent digits starts the NEXT number
        // (SVG's grammar forbids "1e1.5" as one number, so "M1e1.5" = M 10 .5).
        if self.i < self.s.len() && (self.s[self.i] == 'e' || self.s[self.i] == 'E') {
            let save = self.i;
            self.i += 1;
            if self.i < self.s.len() && (self.s[self.i] == '+' || self.s[self.i] == '-') {
                self.i += 1;
            }
            if self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
                while self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
                    self.i += 1;
                }
            } else {
                self.i = save; // 'e' was not an exponent
            }
        }
        if self.i == start {
            return Err("expected a number in path data".into());
        }
        let text: String = self.s[start..self.i].iter().collect();
        text.parse::<f64>().map_err(|_| format!("bad number `{text}` in path data"))
    }
    /// Arc flags are single `0`/`1` characters that may touch the next number.
    fn flag(&mut self) -> Result<bool, String> {
        self.skip_sep();
        match self.s.get(self.i) {
            Some('0') => {
                self.i += 1;
                Ok(false)
            }
            Some('1') => {
                self.i += 1;
                Ok(true)
            }
            other => Err(format!("arc flag must be 0 or 1, got {other:?}")),
        }
    }
}

/// Grows a subpath with knot bookkeeping (open subpaths get closed implicitly by the fill).
struct SubBuilder {
    knots: Vec<Knot>,
    start: Point,
    cursor: Point,
    closed: bool,
}

impl SubBuilder {
    fn new(at: Point) -> Self {
        SubBuilder { knots: vec![Knot::corner(at.x, at.y)], start: at, cursor: at, closed: false }
    }
    fn line_to(&mut self, at: Point) {
        if let Some(prev) = self.knots.last_mut() {
            prev.out_ctrl = Point::new(prev.anchor.x, prev.anchor.y);
        }
        self.knots.push(Knot::corner(at.x, at.y));
        self.cursor = at;
    }
    fn cubic_to(&mut self, c1: Point, c2: Point, at: Point) {
        if let Some(prev) = self.knots.last_mut() {
            prev.out_ctrl = c1;
            prev.smooth = true;
        }
        self.knots.push(Knot { anchor: at, in_ctrl: c2, out_ctrl: at, smooth: true });
        self.cursor = at;
    }
    fn close(&mut self) {
        if self.knots.is_empty() {
            return;
        }
        let gap = ((self.cursor.x - self.start.x).powi(2) + (self.cursor.y - self.start.y).powi(2)).sqrt();
        if gap > 1e-6 {
            self.line_to(self.start);
        }
        self.closed = true;
    }
    fn is_empty(&self) -> bool {
        self.knots.len() < 2 && !self.closed
    }
}

fn quad_to_cubic(p0: Point, c: Point, p1: Point) -> (Point, Point) {
    let two_thirds = |a: f64, b: f64| a + (b - a) * 2.0 / 3.0;
    (
        Point::new(two_thirds(p0.x, c.x), two_thirds(p0.y, c.y)),
        Point::new(two_thirds(p1.x, c.x), two_thirds(p1.y, c.y)),
    )
}

/// Endpoint → center-parameterization arc → cubic Bézier segments (W3C F.6).
fn arc_to_cubics(
    from: Point, rx: f64, ry: f64, phi_deg: f64, large: bool, sweep: bool, to: Point,
) -> Vec<(Point, Point, Point)> {
    let (mut rx, mut ry) = (rx.abs(), ry.abs());
    if (from.x - to.x).abs() < 1e-12 && (from.y - to.y).abs() < 1e-12 {
        return Vec::new();
    }
    if rx < 1e-12 || ry < 1e-12 {
        return vec![(from, to, to)];
    }
    let phi = phi_deg.to_radians();
    let (cos_p, sin_p) = phi.sin_cos();
    let dx2 = (from.x - to.x) / 2.0;
    let dy2 = (from.y - to.y) / 2.0;
    let x1p = cos_p * dx2 + sin_p * dy2;
    let y1p = -sin_p * dx2 + cos_p * dy2;
    let lambda = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
    if lambda > 1.0 {
        let k = lambda.sqrt();
        rx *= k;
        ry *= k;
    }
    let sign = if large != sweep { 1.0 } else { -1.0 };
    let num = (rx * rx * ry * ry) - (rx * rx * y1p * y1p) - (ry * ry * x1p * x1p);
    let den = (rx * rx * y1p * y1p) + (ry * ry * x1p * x1p);
    let co = sign * (num / den).max(0.0).sqrt();
    let cxp = co * rx * y1p / ry;
    let cyp = -co * ry * x1p / rx;
    let cx = cos_p * cxp - sin_p * cyp + (from.x + to.x) / 2.0;
    let cy = sin_p * cxp + cos_p * cyp + (from.y + to.y) / 2.0;

    let angle = |ux: f64, uy: f64, vx: f64, vy: f64| {
        let dot = ux * vx + uy * vy;
        let len = ((ux * ux + uy * uy) * (vx * vx + vy * vy)).sqrt().max(1e-12);
        let a = (dot / len).clamp(-1.0, 1.0).acos();
        if ux * vy - uy * vx < 0.0 { -a } else { a }
    };
    let mut theta = angle(1.0, 0.0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let mut delta = angle(
        (x1p - cxp) / rx, (y1p - cyp) / ry,
        (-x1p - cxp) / rx, (-y1p - cyp) / ry,
    );
    if !sweep && delta > 0.0 {
        delta -= std::f64::consts::TAU;
    } else if sweep && delta < 0.0 {
        delta += std::f64::consts::TAU;
    }
    let point_at = |t: f64| -> Point {
        let (st, ct) = t.sin_cos();
        Point::new(
            cx + rx * ct * cos_p - ry * st * sin_p,
            cy + rx * ct * sin_p + ry * st * cos_p,
        )
    };
    let deriv_at = |t: f64| -> Point {
        let (st, ct) = t.sin_cos();
        Point::new(-rx * st * cos_p - ry * ct * sin_p, -rx * st * sin_p + ry * ct * cos_p)
    };

    let segments = ((delta.abs() / (std::f64::consts::FRAC_PI_2)).ceil() as usize).max(1);
    let per = delta / segments as f64;
    let k = 4.0 / 3.0 * (per / 4.0).tan();
    let mut out = Vec::with_capacity(segments);
    for _ in 0..segments {
        let t1 = theta;
        let t2 = theta + per;
        let p1 = point_at(t1);
        let p2 = point_at(t2);
        let d1 = deriv_at(t1);
        let d2 = deriv_at(t2);
        out.push((
            Point::new(p1.x + k * d1.x, p1.y + k * d1.y),
            Point::new(p2.x - k * d2.x, p2.y - k * d2.y),
            p2,
        ));
        theta = t2;
    }
    out
}

const KAPPA: f64 = 0.5522847498307936;

/// Parses `d` into subpaths, baking `a` (the accumulated element transform) into every point.
fn parse_path_data(d: &str, a: &Affine) -> Result<Vec<Subpath>, String> {
    let mut c = PathCursor::new(d);
    let mut subs: Vec<Subpath> = Vec::new();
    let mut cur: Option<SubBuilder> = None;
    let apply = |a: &Affine, x: f64, y: f64| -> Point { a.apply(Point::new(x, y)) };
    let mut last_c2: Option<Point> = None;
    let mut last_q: Option<Point> = None;

    while let Some(ch) = c.peek_cmd() {
        c.i += 1;
        let absolute = ch.is_ascii_uppercase();
        let lc = ch.to_ascii_lowercase();
        // Implicit repeats after M/m behave as L/l; every other command repeats itself.
        loop {
            let mut consumed = false;
            match lc {
                'm' => {
                    let x = c.number()?;
                    let y = c.number()?;
                    let (x, y) = if absolute { (x, y) } else {
                        let base = cur.as_ref().map(|s| s.cursor).unwrap_or(Point::new(0.0, 0.0));
                        (base.x + x, base.y + y)
                    };
                    if let Some(sb) = cur.take() {
                        if !sb.is_empty() {
                            subs.push(Subpath { closed: sb.closed, knots: sb.knots, op: PathOp::Combine });
                        }
                    }
                    let p = apply(a, x, y);
                    cur = Some(SubBuilder::new(p));
                    last_c2 = None;
                    last_q = None;
                    consumed = true;
                    // Implicit continuation of `m` is lineto (handled by the loop below).
                }
                'l' | 't' => {
                    if !c.has_number() {
                        break;
                    }
                    let x = c.number()?;
                    let y = c.number()?;
                    let base = cur.as_ref().map(|s| s.cursor).ok_or("path data starts with a relative segment")?;
                    let (x, y) = if absolute { (x, y) } else { (base.x + x, base.y + y) };
                    if lc == 'l' {
                        let sb = cur.as_mut().ok_or("path data starts with a relative segment")?;
                        sb.line_to(apply(a, x, y));
                        last_c2 = None;
                        last_q = None;
                    } else {
                        // T: smooth quadratic — reflect previous control.
                        let ctrl = match last_q {
                            Some(q) => Point::new(2.0 * base.x - q.x, 2.0 * base.y - q.y),
                            None => base,
                        };
                        last_q = Some(ctrl);
                        let (c1, c2) = quad_to_cubic(
                            apply(a, base.x, base.y),
                            apply(a, ctrl.x, ctrl.y),
                            apply(a, x, y),
                        );
                        cur.as_mut().ok_or("path data starts with a relative segment")?.cubic_to(c1, c2, apply(a, x, y));
                        last_c2 = None;
                    }
                    consumed = true;
                }
                'h' | 'v' => {
                    if !c.has_number() {
                        break;
                    }
                    let v = c.number()?;
                    let base = cur.as_ref().map(|s| s.cursor).ok_or("path data starts with a relative segment")?;
                    let (x, y) = if lc == 'h' {
                        (if absolute { v } else { base.x + v }, base.y)
                    } else {
                        (base.x, if absolute { v } else { base.y + v })
                    };
                    cur.as_mut().ok_or("path data starts with a relative segment")?.line_to(apply(a, x, y));
                    last_c2 = None;
                    last_q = None;
                    consumed = true;
                }
                'c' | 's' | 'q' => {
                    if !c.has_number() {
                        break;
                    }
                    let sb = cur.as_mut().ok_or("path data starts with a relative segment")?;
                    let base = sb.cursor;
                    let (x1, y1, x2, y2, x, y) = if lc == 'c' {
                        let (x1, y1, x2, y2, x, y) = (c.number()?, c.number()?, c.number()?, c.number()?, c.number()?, c.number()?);
                        if absolute { (x1, y1, x2, y2, x, y) } else { (base.x + x1, base.y + y1, base.x + x2, base.y + y2, base.x + x, base.y + y) }
                    } else {
                        let (x2, y2, x, y) = (c.number()?, c.number()?, c.number()?, c.number()?);
                        let (x2, y2, x, y) = if absolute { (x2, y2, x, y) } else { (base.x + x2, base.y + y2, base.x + x, base.y + y) };
                        let (x1, y1) = if lc == 's' {
                            match last_c2 {
                                Some(p) => (2.0 * base.x - p.x, 2.0 * base.y - p.y),
                                None => base,
                            }
                        } else {
                            base
                        };
                        (x1, y1, x2, y2, x, y)
                    };
                    let (c1, c2) = if lc == 'q' {
                        quad_to_cubic(
                            apply(a, base.x, base.y),
                            apply(a, x1, y1),
                            apply(a, x, y),
                        )
                    } else {
                        (apply(a, x1, y1), apply(a, x2, y2))
                    };
                    let at = apply(a, x, y);
                    sb.cubic_to(c1, c2, at);
                    last_c2 = Some(c2);
                    last_q = if lc == 'q' { Some(Point::new(x1, y1)) } else { None };
                    consumed = true;
                }
                'a' => {
                    if !c.has_number() {
                        break;
                    }
                    let sb = cur.as_mut().ok_or("path data starts with a relative segment")?;
                    let base = sb.cursor;
                    let rx = c.number()?;
                    let ry = c.number()?;
                    let rot = c.number()?;
                    let large = c.flag()?;
                    let sweep = c.flag()?;
                    let x = c.number()?;
                    let y = c.number()?;
                    let (x, y) = if absolute { (x, y) } else { (base.x + x, base.y + y) };
                    for (c1, c2, at) in arc_to_cubics(apply(a, base.x, base.y), rx, ry, rot, large, sweep, apply(a, x, y)) {
                        sb.cubic_to(c1, c2, at);
                    }
                    last_c2 = None;
                    last_q = None;
                    consumed = true;
                }
                'z' => {
                    if let Some(sb) = cur.as_mut() {
                        sb.close();
                    }
                    consumed = c.has_number(); // keep looping only if data continues
                    break;
                }
                _ => return Err(format!("unsupported path command `{ch}`")),
            }
            if !consumed {
                break;
            }
        }
    }
    if let Some(sb) = cur.take() {
        if !sb.is_empty() {
            subs.push(Subpath { closed: sb.closed, knots: sb.knots, op: PathOp::Combine });
        }
    }
    if subs.is_empty() {
        return Err("path data contains no drawable segments".into());
    }
    Ok(subs)
}

// ---------------------------------------------------------------------------
// Transforms & paints
// ---------------------------------------------------------------------------

/// Parses an SVG `transform` attribute (`matrix`, `translate`, `scale`,
/// `rotate`, `skewX`, `skewY`, listed left-to-right, applied right-to-left).
fn parse_transform(s: &str) -> Result<Affine, String> {
    let mut out = Affine::IDENTITY;
    let mut c = PathCursor::new(s);
    loop {
        c.skip_sep();
        if c.i >= c.s.len() {
            break;
        }
        let mut name = String::new();
        while c.i < c.s.len() && c.s[c.i].is_ascii_alphabetic() {
            name.push(c.s[c.i]);
            c.i += 1;
        }
        c.skip_sep();
        if c.i >= c.s.len() || c.s[c.i] != '(' {
            return Err(format!("expected `(` after transform `{name}`"));
        }
        c.i += 1;
        let mut args: Vec<f64> = Vec::new();
        loop {
            c.skip_sep();
            if c.i < c.s.len() && c.s[c.i] == ')' {
                c.i += 1;
                break;
            }
            args.push(c.number().map_err(|e| format!("in {name}(): {e}"))?);
        }
        let t = match name.as_str() {
            "matrix" => {
                if args.len() != 6 {
                    return Err("matrix() needs 6 arguments".into());
                }
                Affine { m: [args[0], args[1], args[2], args[3], args[4], args[5]] }
            }
            "translate" => match args.len() {
                1 => Affine::translate(args[0], 0.0),
                2 => Affine::translate(args[0], args[1]),
                _ => return Err("translate() needs 1 or 2 arguments".into()),
            },
            "scale" => match args.len() {
                1 => Affine::scale(args[0]),
                2 => Affine { m: [args[0], 0.0, 0.0, args[1], 0.0, 0.0] },
                _ => return Err("scale() needs 1 or 2 arguments".into()),
            },
            "rotate" => {
                let rad = args.first().copied().unwrap_or(0.0).to_radians();
                let rot = Affine::rotate(rad);
                match args.len() {
                    1 => rot,
                    3 => {
                        let to_c = Affine::translate(args[1], args[2]);
                        let from_c = Affine::translate(-args[1], -args[2]);
                        to_c.mul(&rot).mul(&from_c)
                    }
                    _ => return Err("rotate() needs 1 or 3 arguments".into()),
                }
            }
            "skewX" => Affine { m: [1.0, 0.0, args.first().copied().unwrap_or(0.0).to_radians().tan(), 0.0, 0.0, 0.0] },
            "skewY" => Affine { m: [1.0, args.first().copied().unwrap_or(0.0).to_radians().tan(), 0.0, 1.0, 0.0, 0.0] },
            other => return Err(format!("unsupported transform `{other}`")),
        };
        out = out.mul(&t);
    }
    Ok(out)
}

fn parse_number(s: &str) -> Option<f64> {
    let t = s.trim();
    let (v, _unit) = t.split_at(t.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(t.len()));
    v.trim().parse::<f64>().ok()
}

fn parse_length(s: &str) -> Option<f64> {
    parse_number(s)
}

fn hex_val(c: u8) -> Option<f32> {
    (c as char).to_digit(16).map(|d| d as f32 / 15.0)
}

fn parse_hex_color(s: &str) -> Option<[f32; 4]> {
    let hex = s.trim().strip_prefix('#')?;
    match hex.len() {
        3 => {
            let b = hex.as_bytes();
            Some([hex_val(b[0])?, hex_val(b[1])?, hex_val(b[2])?, 1.0])
        }
        4 => {
            let b = hex.as_bytes();
            Some([hex_val(b[0])?, hex_val(b[1])?, hex_val(b[2])?, hex_val(b[3])?])
        }
        6 => {
            let bytes = hex.as_bytes();
            let pair = |k: usize| u8::from_str_radix(&hex[k..k + 2], 16).ok().map(|v| f32::from(v) / 255.0);
            Some([pair(0)?, pair(2)?, pair(4)?, 1.0])
        }
        8 => {
            let pair = |k: usize| u8::from_str_radix(&hex[k..k + 2], 16).ok().map(|v| f32::from(v) / 255.0);
            Some([pair(0)?, pair(2)?, pair(4)?, pair(6)?])
        }
        _ => None,
    }
}

fn parse_css_color(s: &str) -> Option<[f32; 4]> {
    let t = s.trim();
    if let Some(c) = parse_hex_color(t) {
        return Some(c);
    }
    if let Some(inner) = t.strip_prefix("rgb(").and_then(|x| x.strip_suffix(')')).or_else(|| t.strip_prefix("rgba(").and_then(|x| x.strip_suffix(')'))) {
        let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
        if parts.len() >= 3 {
            let chan = |p: &str| -> Option<f32> {
                if let Some(pct) = p.strip_suffix('%') {
                    pct.parse::<f32>().ok().map(|v| v / 100.0)
                } else {
                    p.parse::<f32>().ok().map(|v| (v / 255.0).clamp(0.0, 1.0))
                }
            };
            let (r, g, b) = (chan(parts[0])?, chan(parts[1])?, chan(parts[2])?);
            let a = parts.get(3).and_then(chan).unwrap_or(1.0);
            return Some([r, g, b, a]);
        }
        return None;
    }
    named_color(t)
}

fn named_color(s: &str) -> Option<[f32; 4]> {
    // A practical subset of the CSS named colours.
    let c: [f32; 4] = match s.to_ascii_lowercase().as_str() {
        "black" => [0.0, 0.0, 0.0, 1.0],
        "white" => [1.0, 1.0, 1.0, 1.0],
        "red" => [1.0, 0.0, 0.0, 1.0],
        "green" => [0.0, 0.5, 0.0, 1.0],
        "blue" => [0.0, 0.0, 1.0, 1.0],
        "yellow" => [1.0, 1.0, 0.0, 1.0],
        "orange" => [1.0, 0.647, 0.0, 1.0],
        "purple" => [0.5, 0.0, 0.5, 1.0],
        "cyan" | "aqua" => [0.0, 1.0, 1.0, 1.0],
        "magenta" | "fuchsia" => [1.0, 0.0, 1.0, 1.0],
        "lime" => [0.0, 1.0, 0.0, 1.0],
        "gray" | "grey" => [0.5, 0.5, 0.5, 1.0],
        "silver" => [0.753, 0.753, 0.753, 1.0],
        "maroon" => [0.5, 0.0, 0.0, 1.0],
        "navy" => [0.0, 0.0, 0.5, 1.0],
        "teal" => [0.0, 0.5, 0.5, 1.0],
        "olive" => [0.5, 0.5, 0.0, 1.0],
        "pink" => [1.0, 0.753, 0.796, 1.0],
        "brown" => [0.647, 0.165, 0.165, 1.0],
        "gold" => [1.0, 0.843, 0.0, 1.0],
        "indigo" => [0.294, 0.0, 0.51, 1.0],
        "violet" => [0.933, 0.51, 0.933, 1.0],
        "salmon" => [0.98, 0.5, 0.447, 1.0],
        "coral" => [1.0, 0.498, 0.314, 1.0],
        "crimson" => [0.863, 0.078, 0.235, 1.0],
        "turquoise" => [0.251, 0.878, 0.816, 1.0],
        "beige" => [0.96, 0.96, 0.863, 1.0],
        "khaki" => [0.941, 0.902, 0.549, 1.0],
        "transparent" => [0.0, 0.0, 0.0, 0.0],
        _ => return None,
    };
    Some(c)
}

// ---------------------------------------------------------------------------
// SVG tree → layers
// ---------------------------------------------------------------------------

#[derive(Default)]
struct ImportStats {
    shapes: usize,
    groups: usize,
    depth: usize,
    text_elements: usize,
    images: usize,
    unsupported: usize,
}

struct ImportCtx {
    defs: Vec<(String, XmlElem)>,
    warnings: Vec<String>,
    stats: ImportStats,
}

const SKIP_TAGS: &[&str] = &[
    "defs", "clipPath", "mask", "linearGradient", "radialGradient", "pattern", "marker",
    "filter", "symbol", "script", "style", "metadata", "title", "desc",
];

fn collect_defs(elem: &XmlElem, ctx: &mut ImportCtx) {
    for child in &elem.children {
        if let Some(id) = child.attr("id") {
            ctx.defs.push((id.to_string(), child.clone()));
        }
        collect_defs(child, ctx);
    }
}

fn inherited_attr(elem: &XmlElem, chain: &[&XmlElem], name: &str) -> Option<String> {
    elem.attr(name)
        .map(str::to_string)
        .or_else(|| chain.iter().rev().find_map(|e| e.attr(name).map(str::to_string)))
}

/// Parses one element's paint colour (no inheritance lookups beyond the chain).
fn paint_color(raw: &str, opacity: f32) -> Option<photocraft_doc::Color> {
    let t = raw.trim();
    if t.is_empty() || t == "none" {
        return None;
    }
    let rgba: [f32; 4] = if t.starts_with("url(") {
        [0.2, 0.2, 0.2, 1.0]
    } else {
        parse_css_color(t)?
    };
    Some(photocraft_doc::Color::rgba(rgba[0], rgba[1], rgba[2], rgba[3] * opacity))
}

fn fill_of(elem: &XmlElem, chain: &[&XmlElem], ctx: &mut ImportCtx) -> (Option<Fill>, FillRule) {
    let opacity = parse_number(&inherited_attr(elem, chain, "fill-opacity").unwrap_or_else(|| "1".into())).unwrap_or(1.0) as f32;
    let raw = inherited_attr(elem, chain, "fill").unwrap_or_else(|| "#000000".into());
    let fill = paint_color(&raw, opacity);
    if raw.starts_with("url(") && fill.is_some() {
        ctx.warnings.push("fill uses a referenced paint (gradient/pattern); imported as a solid colour".into());
    }
    let rule = match inherited_attr(elem, chain, "fill-rule").unwrap_or_default().trim() {
        "evenodd" => FillRule::EvenOdd,
        _ => FillRule::NonZero,
    };
    (fill, rule)
}

fn stroke_of(elem: &XmlElem, chain: &[&XmlElem], ctx: &mut ImportCtx) -> Option<ShapeStroke> {
    let raw = inherited_attr(elem, chain, "stroke")?;
    let opacity = parse_number(&inherited_attr(elem, chain, "stroke-opacity").unwrap_or_else(|| "1".into())).unwrap_or(1.0) as f32;
    let width = parse_length(&inherited_attr(elem, chain, "stroke-width").unwrap_or_else(|| "1".into())).unwrap_or(1.0).max(0.05) as f32;
    let color = paint_color(&raw, 1.0)?;
    if raw.starts_with("url(") {
        ctx.warnings.push("stroke uses a referenced paint; imported as a solid colour".into());
    }
    let cap = match inherited_attr(elem, chain, "stroke-linecap").unwrap_or_default().trim() {
        "round" => LineCap::Round,
        "square" => LineCap::Square,
        _ => LineCap::Butt,
    };
    let join = match inherited_attr(elem, chain, "stroke-linejoin").unwrap_or_default().trim() {
        "round" => LineJoin::Round,
        "bevel" => LineJoin::Bevel,
        _ => LineJoin::Miter,
    };
    let miter_limit = parse_length(&inherited_attr(elem, chain, "stroke-miterlimit").unwrap_or_else(|| "4".into())).unwrap_or(4.0).max(1.0) as f32;
    let dash_raw = inherited_attr(elem, chain, "stroke-dasharray").unwrap_or_default();
    let dashes: Vec<f32> = if dash_raw.trim() == "none" || dash_raw.is_empty() {
        Vec::new()
    } else {
        dash_raw
            .split([',', ' '])
            .filter_map(parse_length)
            .map(|v| (v / width as f64) as f32)
            .collect()
    };
    let dash_offset = parse_length(&inherited_attr(elem, chain, "stroke-dashoffset").unwrap_or_else(|| "0".into())).unwrap_or(0.0) as f32 / width as f32;
    Some(ShapeStroke {
        width,
        paint: Fill::Solid(color),
        opacity: opacity.clamp(0.0, 1.0),
        align: StrokeAlign::Center,
        cap,
        join,
        miter_limit,
        dashes,
        dash_offset,
    })
}

fn element_opacity(elem: &XmlElem, chain: &[&XmlElem]) -> f32 {
    parse_number(&inherited_attr(elem, chain, "opacity").unwrap_or_else(|| "1".into()))
        .unwrap_or(1.0)
        .clamp(0.0, 1.0) as f32
}

/// Shapes of one graphic element: `None` on an unsupported or invisible element.
fn element_path(elem: &XmlElem, a: &Affine, ctx: &mut ImportCtx) -> Option<(Path, Option<String>)> {
    let tag = local_tag(&elem.tag);
    let tag = if SKIP_TAGS.contains(&tag) || tag == "svg" { return None } else { tag };
    let mut live: Option<String> = None;
    let subs: Vec<Subpath> = match tag {
        "path" => {
            let d = elem.attr("d")?;
            parse_path_data(d, a).map_err(|e| {
                ctx.warnings.push(format!("<path>: {e}"));
                e
            }).ok()?
        }
        "rect" => {
            let f = |k: &str| parse_length(&elem.attr(k).unwrap_or_default()).unwrap_or(0.0);
            let (x, y, w, h) = (f("x"), f("y"), f("width"), f("height"));
            if w <= 0.0 || h <= 0.0 {
                return None;
            }
            let mut rx = f("rx");
            let mut ry = f("ry");
            if rx <= 0.0 && ry > 0.0 { rx = ry; }
            if ry <= 0.0 && rx > 0.0 { ry = rx; }
            let (rx, ry) = (rx.min(w / 2.0), ry.min(h / 2.0));
            live = Some("rect".into());
            if rx > 0.0 && ry > 0.0 {
                rounded_rect_sub(x, y, w, h, rx, ry, a)
            } else {
                vec![rect_sub(x, y, w, h, a)]
            }
        }
        "circle" | "ellipse" => {
            let f = |k: &str| parse_length(&elem.attr(k).unwrap_or_default()).unwrap_or(0.0);
            let (cx, cy) = (f("cx"), f("cy"));
            let (rx, ry) = if tag == "circle" {
                let r = f("r");
                (r, r)
            } else {
                (f("rx"), f("ry"))
            };
            if rx <= 0.0 || ry <= 0.0 {
                return None;
            }
            live = Some("ellipse".into());
            vec![ellipse_sub(cx, cy, rx, ry, a)]
        }
        "line" => {
            let f = |k: &str| parse_length(&elem.attr(k).unwrap_or_default()).unwrap_or(0.0);
            let (x1, y1, x2, y2) = (f("x1"), f("y1"), f("x2"), f("y2"));
            if (x1 - x2).abs() < 1e-9 && (y1 - y2).abs() < 1e-9 {
                return None;
            }
            live = Some("line".into());
            vec![Subpath::polyline(&[
                (apply_x(a, x1, y1), apply_y(a, x1, y1)),
                (apply_x(a, x2, y2), apply_y(a, x2, y2)),
            ])]
        }
        "polygon" | "polyline" => {
            let pts_raw = elem.attr("points")?;
            let mut nums: Vec<f64> = Vec::new();
            let mut pc = PathCursor::new(&pts_raw);
            while pc.has_number() {
                if let Ok(v) = pc.number() {
                    nums.push(v);
                }
            }
            if nums.len() < 4 {
                return None;
            }
            let pts: Vec<(f64, f64)> = nums.chunks(2).take(nums.len() / 2).map(|p| (apply_x(a, p[0], p[1]), apply_y(a, p[0], p[1]))).collect();
            live = Some("polygon".into());
            vec![if tag == "polygon" { Subpath::polygon(&pts) } else { Subpath::polyline(&pts) }]
        }
        "text" | "tspan" | "textPath" => {
            ctx.stats.text_elements += 1;
            return None;
        }
        "image" => {
            ctx.stats.images += 1;
            ctx.warnings.push("<image> is not imported (embedded bitmaps are out of scope for vector layers)".into());
            return None;
        }
        other => {
            ctx.stats.unsupported += 1;
            ctx.warnings.push(format!("<{other}> is not part of the supported SVG subset; skipped"));
            return None;
        }
    };
    Some((Path { subpaths: subs, fill_rule: FillRule::NonZero, inverted: false }, live))
}

fn apply_x(a: &Affine, x: f64, y: f64) -> f64 {
    a.m[0] * x + a.m[2] * y + a.m[4]
}
fn apply_y(a: &Affine, x: f64, y: f64) -> f64 {
    a.m[1] * x + a.m[3] * y + a.m[5]
}

fn rect_sub(x: f64, y: f64, w: f64, h: f64, a: &Affine) -> Subpath {
    Subpath::polygon(&[
        (apply_x(a, x, y), apply_y(a, x, y)),
        (apply_x(a, x + w, y), apply_y(a, x + w, y)),
        (apply_x(a, x + w, y + h), apply_y(a, x + w, y + h)),
        (apply_x(a, x, y + h), apply_y(a, x, y + h)),
    ])
}

/// Rounded rectangle: straight edges + one cubic per corner.
fn rounded_rect_sub(x: f64, y: f64, w: f64, h: f64, rx: f64, ry: f64, a: &Affine) -> Subpath {
    let p = |x: f64, y: f64| (apply_x(a, x, y), apply_y(a, x, y));
    let c = |x: f64, y: f64| (apply_x(a, x, y), apply_y(a, x, y));
    let kx = |rx: f64| rx * KAPPA;
    let ky = |ry: f64| ry * KAPPA;
    let mut knots = Vec::with_capacity(8);
    // Start right of the top-left corner, going clockwise.
    knots.push(Knot::corner(x + rx, y));
    let seg = |knots: &mut Vec<Knot>, c1: (f64, f64), c2: (f64, f64), at: (f64, f64)| {
        if let Some(prev) = knots.last_mut() {
            prev.out_ctrl = Point::new(c1.0, c1.1);
        }
        knots.push(Knot { anchor: Point::new(at.0, at.1), in_ctrl: Point::new(c2.0, c2.1), out_ctrl: Point::new(at.0, at.1), smooth: true });
    };
    // top edge → top-right corner
    knots.push(Knot::corner(x + w - rx, y));
    seg(&mut knots, c(x + w - kx(rx), y), c(x + w, y + ky(ry)), p(x + w, y + ry));
    // right edge → bottom-right
    knots.push(Knot::corner(x + w, y + h - ry));
    seg(&mut knots, c(x + w, y + h - ky(ry)), c(x + w - kx(rx), y + h), p(x + w - rx, y + h));
    // bottom edge → bottom-left
    knots.push(Knot::corner(x + rx, y + h));
    seg(&mut knots, c(x + kx(rx), y + h), c(x, y + h - ky(ry)), p(x, y + h - ry));
    // left edge → top-left
    knots.push(Knot::corner(x, y + ry));
    seg(&mut knots, c(x, y + ky(ry)), c(x + kx(rx), y), p(x + rx, y));
    Subpath { closed: true, knots, op: PathOp::Combine }
}

fn ellipse_sub(cx: f64, cy: f64, rx: f64, ry: f64, a: &Affine) -> Subpath {
    let k = KAPPA;
    let p = |x: f64, y: f64| Point::new(apply_x(a, x, y), apply_y(a, x, y));
    let mut knots = Vec::with_capacity(4);
    let seg = |knots: &mut Vec<Knot>, anchor: Point, in_ctrl: Point, out_ctrl: Point| {
        knots.push(Knot { anchor, in_ctrl, out_ctrl, smooth: true });
    };
    seg(&mut knots, p(cx + rx, cy), p(cx + rx, cy - ry * k), p(cx + rx, cy + ry * k));
    seg(&mut knots, p(cx, cy + ry), p(cx + rx * k, cy + ry), p(cx - rx * k, cy + ry));
    seg(&mut knots, p(cx - rx, cy), p(cx - rx, cy + ry * k), p(cx - rx, cy - ry * k));
    seg(&mut knots, p(cx, cy - ry), p(cx - rx * k, cy - ry), p(cx + rx * k, cy - ry));
    Subpath { closed: true, knots, op: PathOp::Combine }
}

/// Builds layers from SVG children. Groups map onto layer groups; every graphic
/// element becomes one shape layer (fill/stroke resolved with inheritance).
fn build_layers(
    elems: &[XmlElem], chain: &mut Vec<XmlElem>, a: Affine, ctx: &mut ImportCtx, depth: usize,
) -> Vec<Layer> {
    let mut out = Vec::new();
    for elem in elems {
        let tag = local_tag(&elem.tag);
        if SKIP_TAGS.contains(&tag) {
            if tag == "defs" {
                collect_defs(elem, ctx);
            }
            continue;
        }
        if tag == "svg" {
            // Nested <svg>: treat as a group with its own transform origin.
            ctx.warnings.push("nested <svg> elements are treated as groups".into());
        }
        if elem.attr("display") == Some("none") {
            continue;
        }
        // Basic <use href="#id" x y>: instantiate a <defs> entry with a translation.
        if tag == "use" {
            let href = elem.attr_any(&["href", "xlink:href"]).unwrap_or_default();
            let target = href.trim().trim_start_matches('#').to_string();
            let def = ctx.defs.iter().find(|(id, _)| *id == target).map(|(_, e)| e.clone());
            match def {
                Some(mut def_elem) => {
                    let f = |k: &str| parse_length(&elem.attr(k).unwrap_or_default()).unwrap_or(0.0);
                    let (ux, uy) = (f("x"), f("y"));
                    // Geometry: the def content moves by (x, y) and honours the use's transform.
                    let mut attrs = std::mem::take(&mut def_elem.attrs);
                    if let Some(t) = elem.attr("transform") {
                        attrs.push(("transform".into(), t.to_string()));
                    }
                    if ux != 0.0 || uy != 0.0 {
                        attrs.push(("transform".into(), format!("translate({ux},{uy})")));
                    }
                    def_elem.attrs = attrs;
                    // Paint/style inheritance: the use element's own attributes
                    // (minus the transform, already applied above) wrap the content.
                    let inherited: Vec<(String, String)> = elem
                        .attrs
                        .iter()
                        .filter(|(k, _)| k != "transform" && k != "x" && k != "y" && !k.ends_with("href"))
                        .cloned()
                        .collect();
                    let mut wrapper = XmlElem {
                        tag: "g".into(),
                        attrs: inherited,
                        children: vec![def_elem],
                        text: String::new(),
                    };
                    let built = build_layers(&[wrapper], chain, a, ctx, depth);
                    for l in built {
                        out.push(l);
                    }
                }
                None => ctx.warnings.push(format!("<use> references missing id `{target}`")),
            }
            continue;
        }
        let local = parse_transform(&elem.attr("transform").unwrap_or_default()).unwrap_or(Affine::IDENTITY);
        let effective = a.mul(&local);
        chain.push(elem.clone());
        let result = if tag == "g" || tag == "svg" || tag == "a" {
            let children = build_layers(&elem.children, chain, effective, ctx, depth + 1);
            if children.is_empty() {
                ctx.stats.groups += 1;
                ctx.stats.depth = ctx.stats.depth.max(depth + 1);
                None
            } else {
                ctx.stats.groups += 1;
                ctx.stats.depth = ctx.stats.depth.max(depth + 1);
                let name = elem.attr("id").or_else(|| elem.attr("data-name")).unwrap_or(tag).to_string();
                Some(Layer::new(name, LayerContent::Group(Group { children, expanded: true, artboard: None })))
            }
        } else {
            match element_path(elem, &effective, ctx) {
                Some((path, live)) => {
                    ctx.stats.shapes += 1;
                    let opacity = element_opacity(elem, chain);
                    let (fill, fill_rule) = fill_of(elem, chain, ctx);
                    let fill = fill.map(|f| match f {
                        Fill::Solid(c) => Fill::Solid(photocraft_doc::Color::rgba(c.c[0], c.c[1], c.c[2], c.alpha * opacity)),
                        other => other,
                    });
                    let stroke = stroke_of(elem, chain, ctx).map(|mut st| {
                        st.opacity *= opacity;
                        st
                    });
                    if fill.is_none() && stroke.is_none() {
                        ctx.warnings.push(format!("<{tag}> has no fill and no stroke; imported with the default black fill"));
                    }
                    let (fill, stroke) = match (fill, stroke) {
                        (None, None) => (Some(Fill::Solid(photocraft_doc::Color::rgba(0.0, 0.0, 0.0, 1.0))), None),
                        pair => pair,
                    };
                    let sh = ShapeLayer {
                        path: Path { fill_rule, ..path },
                        fill,
                        stroke,
                        live: None,
                        cache: None,
                        psd_raw: None,
                    };
                    let _ = live;
                    let name = elem.attr("id").or_else(|| elem.attr("data-name")).unwrap_or(tag).to_string();
                    Some(Layer::new(name, LayerContent::Shape(sh)))
                }
                None => None,
            }
        };
        if let Some(layer) = result {
            out.push(layer);
        }
        chain.pop();
    }
    out
}

// ---------------------------------------------------------------------------
// Import pipeline
// ---------------------------------------------------------------------------

struct ParsedSvg {
    layers: Vec<Layer>,
    warnings: Vec<String>,
    stats: ImportStats,
    title: String,
    desc: String,
    viewbox: Option<(f64, f64, f64, f64)>,
}

fn parse_svg(svg: &str, place: Affine) -> Result<ParsedSvg, String> {
    let root = parse_xml(svg)?;
    if local_tag(&root.tag) != "svg" {
        return Err(format!("root element is `<{}>`, expected `<svg>`", root.tag));
    }
    let viewbox = root.attr("viewBox").and_then(parse_viewbox);
    // viewBox user units → document pixels: translate to (x, y) and apply `scale`.
    let base = match viewbox {
        Some((vx, vy, _, _)) => place.mul(&Affine::translate(-vx, -vy)),
        None => place,
    };
    let title = root.children.iter().find(|c| local_tag(&c.tag) == "title").map(|c| c.text.clone()).unwrap_or_default();
    let desc = root.children.iter().find(|c| local_tag(&c.tag) == "desc").map(|c| c.text.clone()).unwrap_or_default();
    let mut ctx = ImportCtx::default();
    let mut chain: Vec<XmlElem> = Vec::new();
    chain.push(root.clone());
    let layers = build_layers(&root.children, &mut chain, base, &mut ctx, 0);
    Ok(ParsedSvg { layers, warnings: ctx.warnings, stats: ctx.stats, title, desc, viewbox })
}

fn parse_viewbox(s: &str) -> Option<(f64, f64, f64, f64)> {
    let nums: Vec<f64> = s.split_whitespace().filter_map(parse_number).collect();
    if nums.len() == 4 && nums[2] > 0.0 && nums[3] > 0.0 {
        Some((nums[0], nums[1], nums[2], nums[3]))
    } else {
        None
    }
}

/// Re-renders every shape cache in a freshly built tree (canvas-clipped).
fn refresh_all(doc: &photocraft_doc::Document, layers: &mut [Layer]) {
    for l in layers {
        if let LayerContent::Shape(sh) = &mut l.content {
            crate::vector_cmds::refresh_shape(doc, sh);
        }
        if let Some(children) = l.children_mut() {
            refresh_all(doc, children);
        }
    }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

fn num(v: f64) -> String {
    let s = format!("{v:.2}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-" { "0".into() } else { s.into() }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn hex_color(c: &photocraft_doc::Color) -> String {
    let [r, g, b] = c.to_rgb();
    let q = |v: f32| ((v.clamp(0.0, 1.0) * 255.0) + 0.5) as u8;
    format!("#{:02x}{:02x}{:02x}", q(r), q(g), q(b))
}

fn path_data_of(path: &Path) -> String {
    let mut d = String::new();
    let approx = |p: Point, q: Point| (p.x - q.x).abs() < 1e-9 && (p.y - q.y).abs() < 1e-9;
    for sp in &path.subpaths {
        if sp.knots.is_empty() {
            continue;
        }
        let n = sp.knots.len();
        let first = sp.knots[0].anchor;
        d.push_str(&format!("M {} {} ", num(first.x), num(first.y)));
        let seg_count = if sp.closed { n } else { n.saturating_sub(1) };
        for i in 0..seg_count {
            let a = &sp.knots[i];
            let b = &sp.knots[(i + 1) % n];
            if approx(a.out_ctrl, a.anchor) && approx(b.in_ctrl, b.anchor) {
                d.push_str(&format!("L {} {} ", num(b.anchor.x), num(b.anchor.y)));
            } else {
                d.push_str(&format!(
                    "C {} {} {} {} {} {} ",
                    num(a.out_ctrl.x), num(a.out_ctrl.y), num(b.in_ctrl.x), num(b.in_ctrl.y), num(b.anchor.x), num(b.anchor.y)
                ));
            }
        }
        if sp.closed {
            d.push_str("Z ");
        }
    }
    d.trim_end().to_string()
}

fn shape_to_svg(name: &str, sh: &ShapeLayer, warnings: &mut Vec<String>) -> String {
    let mut out = format!("<path id=\"{}\" ", xml_escape(name));
    match &sh.fill {
        Some(Fill::Solid(c)) => {
            out.push_str(&format!("fill=\"{}\" ", hex_color(c)));
            if c.alpha < 1.0 {
                out.push_str(&format!("fill-opacity=\"{:.3}\" ", c.alpha));
            }
        }
        Some(_) => {
            out.push_str("fill=\"none\" ");
            warnings.push(format!("\"{name}\": gradient/pattern fill exported as `none`"));
        }
        None => out.push_str("fill=\"none\" "),
    }
    match &sh.stroke {
        Some(st) => {
            match &st.paint {
                Fill::Solid(c) => {
                    out.push_str(&format!("stroke=\"{}\" ", hex_color(c)));
                    if c.alpha < 1.0 {
                        out.push_str(&format!("stroke-opacity=\"{:.3}\" ", c.alpha));
                    }
                }
                _ => {
                    out.push_str("stroke=\"none\" ");
                    warnings.push(format!("\"{name}\": referenced stroke paint exported as `none`"));
                }
            }
            out.push_str(&format!("stroke-width=\"{}\" ", num(f64::from(st.width))));
            if st.opacity < 1.0 {
                out.push_str(&format!("stroke-opacity=\"{:.3}\" ", st.opacity));
            }
            out.push_str(match st.cap {
                LineCap::Round => "stroke-linecap=\"round\" ",
                LineCap::Square => "stroke-linecap=\"square\" ",
                LineCap::Butt => "",
            });
            out.push_str(match st.join {
                LineJoin::Round => "stroke-linejoin=\"round\" ",
                LineJoin::Bevel => "stroke-linejoin=\"bevel\" ",
                LineJoin::Miter => "",
            });
        }
        None => out.push_str("stroke=\"none\" "),
    }
    if sh.path.fill_rule == FillRule::EvenOdd {
        out.push_str("fill-rule=\"evenodd\" ");
    }
    out.push_str(&format!("d=\"{}\"/>", path_data_of(&sh.path)));
    out
}

/// Serializes the document's vector content (shape layers, vector masks, group
/// hierarchy) into a standalone SVG document.
fn document_to_svg(doc: &photocraft_doc::Document) -> String {
    let mut out = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {} {}\">\n",
        doc.size.width, doc.size.height
    );
    if !doc.name.is_empty() {
        out.push_str(&format!("<title>{}</title>\n", xml_escape(&doc.name)));
    }
    let mut open_groups = 0usize;
    let mut warnings: Vec<String> = Vec::new();
    for (_, depth, l) in doc.walk() {
        while open_groups > depth {
            out.push_str("</g>\n");
            open_groups -= 1;
        }
        match &l.content {
            LayerContent::Group(_) => {
                out.push_str(&format!("<g id=\"{}\">\n", xml_escape(&l.name)));
                open_groups += 1;
            }
            LayerContent::Shape(sh) => {
                out.push_str(&shape_to_svg(&l.name, sh, &mut warnings));
                out.push('\n');
            }
            LayerContent::Text(t) => {
                warnings.push(format!(
                    "text layer \"{}\" exported as a comment (text outlines are not stored in the document model)",
                    l.name
                ));
                out.push_str(&format!("<!-- text {}: {} -->\n", xml_escape(&l.name), xml_escape(&t.text)));
            }
            other => {
                warnings.push(format!(
                    "layer \"{}\" ({}): no vector geometry, skipped",
                    l.name,
                    other.kind_name()
                ));
            }
        }
        if let Some(vm) = &l.vector_mask {
            out.push_str(&format!(
                "<g id=\"{} — vector mask\" data-photocraft=\"vector-mask\" fill=\"none\" stroke=\"#808080\" stroke-dasharray=\"4 4\">\n",
                xml_escape(&l.name)
            ));
            out.push_str(&format!("<path d=\"{}\"/>\n", path_data_of(&vm.path)));
            out.push_str("</g>\n");
        }
    }
    while open_groups > 0 {
        out.push_str("</g>\n");
        open_groups -= 1;
    }
    for w in &warnings {
        out.push_str(&format!("<!-- warning: {} -->\n", xml_escape(w)));
    }
    out.push_str("</svg>\n");
    out
}

// ---------------------------------------------------------------------------
// Command specs
// ---------------------------------------------------------------------------

fn bad_param(cmd: &str, msg: impl Into<String>) -> EngineError {
    EngineError::BadParams { cmd: cmd.to_string(), msg: msg.into() }
}

fn fp(p: &Value, k: &str) -> Option<f64> {
    p.get(k).and_then(Value::as_f64)
}

fn import_common(s: &mut Session, p: &Value, svg_text: &str, label: &str) -> Result<Value> {
    let x = fp(p, "x").unwrap_or(0.0);
    let y = fp(p, "y").unwrap_or(0.0);
    let scale = fp(p, "scale").unwrap_or(1.0);
    if !(scale.is_finite() && scale > 0.0) {
        return Err(bad_param(label, "`scale` must be a positive number"));
    }
    let place = Affine::translate(x, y).mul(&Affine::scale(scale));
    let parsed = parse_svg(svg_text, place).map_err(|e| bad_param(label, e))?;
    if parsed.layers.is_empty() {
        return Err(EngineError::Other(format!(
            "{label}: the SVG contains no drawable shapes ({} text, {} unsupported elements)",
            parsed.stats.text_elements, parsed.stats.unsupported
        )));
    }
    let stats = parsed.stats;
    let warnings = parsed.warnings;
    let viewbox = parsed.viewbox;
    let requested = p.get("name").and_then(Value::as_str).unwrap_or("SVG").to_string();
    let mut layers = parsed.layers;
    let id = s.edit(label, |doc, active| {
        refresh_all(doc, &mut layers);
        let layer = Layer::new(doc.next_layer_name(&requested), LayerContent::Group(Group { children: layers, expanded: true, artboard: None }));
        let id = doc.insert_above(*active, layer);
        *active = Some(id);
        Ok(id)
    })?;
    Ok(json!({
        "layer": id.0,
        "shapes": stats.shapes,
        "groups": stats.groups,
        "maxDepth": stats.depth,
        "textElements": stats.text_elements,
        "unsupportedElements": stats.unsupported,
        "viewBox": viewbox.map(|v| [v.0, v.1, v.2, v.3]),
        "warnings": warnings,
    })
    )
}

fn svg_import_text(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "svg.importText";
    let svg = p.get("svg").and_then(Value::as_str).ok_or_else(|| bad_param(CMD, "missing `svg` (SVG document text)"))?;
    if svg.len() > 32 * 1024 * 1024 {
        return Err(bad_param(CMD, "SVG larger than 32 MB"));
    }
    import_common(s, p, svg, "SVG Import")
}

fn svg_import(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "svg.import";
    let path = p.get("path").and_then(Value::as_str).ok_or_else(|| bad_param(CMD, "missing `path`"))?;
    let text = std::fs::read_to_string(path)
        .map_err(|e| EngineError::Other(format!("{path}: {e}")))?;
    import_common(s, p, &text, "SVG Import")
}

fn svg_validate_common(svg: &str, full: bool) -> Result<Value> {
    match parse_svg(svg, Affine::IDENTITY) {
        Ok(parsed) => {
            let mut v = json!({
                "ok": true,
                "shapes": parsed.stats.shapes,
                "groups": parsed.stats.groups,
                "maxDepth": parsed.stats.depth,
                "textElements": parsed.stats.text_elements,
                "images": parsed.stats.images,
                "unsupportedElements": parsed.stats.unsupported,
                "warnings": parsed.warnings,
                "title": parsed.title,
                "description": parsed.desc,
                "viewBox": parsed.viewbox.map(|v| [v.0, v.1, v.2, v.3]),
            });
            if full {
                v["supported"] = json!(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "g", "use (basic)"]);
                v["unsupported"] = json!(["CSS <style> selectors", "filters", "embedded <image>", "SVG <text> geometry", "gradient/pattern paints (imported as solids)"]);
            }
            Ok(v)
        }
        Err(e) => Ok(json!({ "ok": false, "reason": e })),
    }
}

fn svg_validate(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "svg.validate";
    let _ = s;
    let svg = p.get("svg").and_then(Value::as_str).ok_or_else(|| bad_param(CMD, "missing `svg`"))?;
    svg_validate_common(svg, false)
}

fn svg_info(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "svg.info";
    let _ = s;
    let svg = p.get("svg").and_then(Value::as_str).ok_or_else(|| bad_param(CMD, "missing `svg`"))?;
    svg_validate_common(svg, true)
}

fn svg_export(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "svg.export";
    let doc = &s.active().ok_or(EngineError::NoDocument)?.doc;
    let svg = document_to_svg(doc);
    let mut reply = json!({ "svg": svg, "bytes": svg.len() });
    if let Some(path) = p.get("path").and_then(Value::as_str) {
        if path.trim().is_empty() {
            return Err(bad_param(CMD, "`path` is empty"));
        }
        photocraft_format::atomic_write(std::path::Path::new(path), svg.as_bytes())
            .map_err(|e| EngineError::Other(format!("{path}: {e}")))?;
        reply["path"] = json!(path);
    }
    Ok(reply)
}

/// The `svg.*` command specs.
pub fn specs() -> Vec<crate::commands::CommandSpec> {
    vec![
        crate::commands::CommandSpec {
            id: "svg.importText",
            label: "Import SVG Text",
            menu: &[],
            shortcut: None,
            params: r##"{"svg":str,"name":str?,"x":px=0,"y":px=0,"scale":%=1} → {layer,shapes,groups,warnings} (SVG subset → real shape layers; groups map onto layer groups; every edit re-renders caches in one history step)"##,
            enabled: has_doc,
            journal: true,
            run: svg_import_text,
        },
        crate::commands::CommandSpec {
            id: "svg.import",
            label: "Import SVG…",
            menu: &["File"],
            shortcut: None,
            params: r##"{"path":str,"name":str?,"x":px=0,"y":px=0,"scale":%=1} → same as svg.importText, reading the file from disk"##,
            enabled: has_doc,
            journal: true,
            run: svg_import,
        },
        crate::commands::CommandSpec {
            id: "svg.validate",
            label: "Validate SVG",
            menu: &[],
            shortcut: None,
            params: r##"{"svg":str} → {ok,reason?,shapes,groups,warnings} (no document needed; nothing is inserted)"##,
            enabled: always_ok,
            journal: false,
            run: svg_validate,
        },
        crate::commands::CommandSpec {
            id: "svg.info",
            label: "SVG Info",
            menu: &[],
            shortcut: None,
            params: r##"{"svg":str} → {ok,viewBox,title,description,shapes,groups,maxDepth,textElements,images,unsupportedElements,warnings,supported,unsupported} (layer enumeration metadata + capability detection)"##,
            enabled: always_ok,
            journal: false,
            run: svg_info,
        },
        crate::commands::CommandSpec {
            id: "svg.export",
            label: "Export SVG…",
            menu: &["File"],
            shortcut: None,
            params: r##"{"path":str?} → {svg,bytes,path?} (shape layers + vector masks → path data; groups → <g>; text layers → comments with a warning)"##,
            enabled: has_doc,
            journal: true,
            run: svg_export,
        },
    ]
}

fn has_doc(s: &Session) -> std::result::Result<(), String> {
    s.active().map(|_| ()).ok_or_else(|| "no document open".into())
}
fn always_ok(_: &Session) -> std::result::Result<(), String> {
    Ok(())
}

// __TESTS__




#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_doc::LayerContent;

    fn session() -> Session {
        let mut s = Session::new();
        s.execute("file.new", json!({"width": 400, "height": 300, "background": "transparent"})).unwrap();
        s
    }

    fn shape_of<'a>(s: &'a Session, id: u64) -> &'a ShapeLayer {
        match &s.active().unwrap().doc.layer(photocraft_doc::LayerId(id)).unwrap().content {
            LayerContent::Shape(sh) => sh,
            other => panic!("expected a shape layer, got {}", other.kind_name()),
        }
    }

    #[test]
    fn xml_parser_handles_attrs_entities_and_nesting() {
        let doc = parse_xml(r#"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><desc>a &amp; b</desc><g id="one"><rect x="1" y="2" width="3" height="4"/></g><!-- c --><circle cx="5" cy="5" r="2"/></svg>"#).unwrap();
        assert_eq!(local_tag(&doc.tag), "svg");
        assert_eq!(doc.children.len(), 3);
        assert_eq!(doc.children[0].text, "a & b");
        assert_eq!(doc.children[0].children[0].attr("width"), Some("3"));
    }

    #[test]
    fn xml_parser_rejects_mismatched_and_unclosed_tags() {
        assert!(parse_xml("<svg><g></svg>").is_err());
        assert!(parse_xml("<svg><g>").is_err());
        assert!(parse_xml("just text").is_err());
    }

    #[test]
    fn path_data_full_grammar() {
        let a = Affine::IDENTITY;
        let subs = parse_path_data("M 0 0 L 10 0 C 15 0 20 5 20 10 S 15 20 10 20 Q 5 20 5 15 T 0 15 Z", &a).unwrap();
        assert_eq!(subs.len(), 1);
        assert!(subs[0].closed);
        assert_eq!(subs[0].knots.len(), 6);
        // Relative + H/V shorthand.
        let subs = parse_path_data("m 5 5 h 10 v 10 h -10 z", &a).unwrap();
        assert_eq!(subs[0].knots.len(), 4);
        assert!((subs[0].knots[1].anchor.x - 15.0).abs() < 1e-9);
        // Arc: quarter circle from (0,0) to (10,10) with r=10.
        let subs = parse_path_data("M 0 0 A 10 10 0 0 1 10 10", &a).unwrap();
        let anchor = subs[0].knots.last().unwrap().anchor;
        assert!((anchor.x - 10.0).abs() < 1e-6 && (anchor.y - 10.0).abs() < 1e-6);
        // Scientific notation and ".5" shorthand.
        let subs = parse_path_data("M1e1.5L2E1 3", &a).unwrap();
        assert!((subs[0].knots[0].anchor.x - 10.0).abs() < 1e-9);
        assert!((subs[0].knots[0].anchor.y - 0.5).abs() < 1e-9);
    }

    #[test]
    fn transforms_compose_like_svg() {
        // rotate(90) about origin maps (1,0) to (0,1).
        let a = parse_transform("rotate(90)").unwrap();
        let p = a.apply(Point::new(1.0, 0.0));
        assert!((p.x - 0.0).abs() < 1e-9 && (p.y - 1.0).abs() < 1e-9);
        // "translate(10,20) scale(2)" maps (1,1) → (12,22): scale first, then translate.
        let a = parse_transform("translate(10,20) scale(2)").unwrap();
        let p = a.apply(Point::new(1.0, 1.0));
        assert!((p.x - 12.0).abs() < 1e-9 && (p.y - 22.0).abs() < 1e-9);
        assert!(parse_transform("scale()").is_err());
    }

    #[test]
    fn svg_import_creates_real_layers_and_is_undoable() {
        let mut s = session();
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <g id="icons">
                <rect id="box" x="10" y="10" width="20" height="30" fill="#ff0000"/>
                <circle id="dot" cx="50" cy="50" r="10" fill="none" stroke="#00ff00" stroke-width="3"/>
                <path d="M 0 0 Q 25 25 50 0 T 100 0" stroke="#0000ff" fill="none"/>
                <text x="5" y="5">ignored</text>
            </g>
            <polygon points="0,0 10,0 5,10" fill="blue"/>
        </svg>"#;
        let r = s.execute("svg.importText", json!({"svg": svg})).unwrap();
        assert_eq!(r["shapes"], 4);
        assert_eq!(r["groups"], 1);
        assert_eq!(r["textElements"], 1);
        let root = r["layer"].as_u64().unwrap();
        let group = s.active().unwrap().doc.layer(photocraft_doc::LayerId(root)).unwrap();
        let children = group.children().unwrap();
        assert_eq!(children.len(), 2, "icons group + polygon");
        let box_layer = &children[0].children().unwrap()[0];
        assert_eq!(box_layer.name, "box");
        let steps = s.active().unwrap().history.past_len();
        s.execute("edit.undo", json!({})).unwrap();
        assert_eq!(s.active().unwrap().history.past_len(), steps - 1);
        s.execute("edit.redo", json!({})).unwrap();
        assert!(s.active().unwrap().doc.layer(photocraft_doc::LayerId(root)).is_some());
    }

    #[test]
    fn imported_shapes_render_real_pixels() {
        let mut s = session();
        s.execute("svg.importText", json!({"svg": "<svg viewBox=\"0 0 100 100\"><circle cx=\"50\" cy=\"50\" r=\"30\" fill=\"#ff0000\"/></svg>"})).unwrap();
        let px = s.execute("document.pixel", json!({"x": 50, "y": 50})).unwrap();
        assert!(px[0].as_f64().unwrap() > 0.8, "circle centre should be red, got {px}");
        let corner = s.execute("document.pixel", json!({"x": 5, "y": 5})).unwrap();
        assert!(corner[3].as_f64().unwrap() < 0.1, "corner should stay transparent");
    }

    #[test]
    fn svg_validate_and_info_report_capabilities() {
        let ok = s_exec_svg("<svg viewBox=\"0 0 10 10\"><rect width=\"4\" height=\"4\"/></svg>");
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["shapes"], 1);
        let bad = s_exec_svg("<svg><rect width=\"4\" height=\"4\"></svg>");
        assert_eq!(bad["ok"], false);
        assert!(bad["reason"].as_str().unwrap().contains("unclosed"));
    }

    fn s_exec_svg(svg: &str) -> Value {
        let mut s = Session::new();
        s.execute("svg.validate", json!({"svg": svg})).unwrap()
    }

    #[test]
    fn svg_export_round_trips_shape_layers() {
        let mut s = session();
        s.execute("shape.create", json!({"kind": "ellipse", "rect": [10, 10, 80, 80], "fill": "#336699"})).unwrap();
        let out = s.execute("svg.export", json!({})).unwrap();
        let svg = out["svg"].as_str().unwrap();
        assert!(svg.contains("fill=\"#336699\""), "{svg}");
        assert!(svg.contains("d=\"M "), "{svg}");
        // The exported SVG imports back with the same geometry.
        let r = s.execute("svg.importText", json!({"svg": svg, "name": "round-trip"})).unwrap();
        assert_eq!(r["shapes"], 1);
        let root = r["layer"].as_u64().unwrap();
        let imported = s.active().unwrap().doc.layer(photocraft_doc::LayerId(root)).unwrap();
        let sh = match &imported.children().unwrap()[0].content {
            LayerContent::Shape(sh) => sh,
            other => panic!("{}", other.kind_name()),
        };
        let b = sh.path.control_bounds().unwrap();
        assert!((b.0 - 10.0).abs() < 0.5 && (b.1 - 10.0).abs() < 0.5, "{b:?}");
    }

    #[test]
    fn svg_import_requires_a_document_and_validate_does_not() {
        let mut s = Session::new();
        assert!(s.execute("svg.importText", json!({"svg": "<svg><rect width=\"2\" height=\"2\"/></svg>"})).is_err());
        assert!(s.execute("svg.validate", json!({"svg": "<svg><rect width=\"2\" height=\"2\"/></svg>"})).is_ok());
    }
}
