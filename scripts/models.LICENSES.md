# Background-removal models: sources and licences

PhotoCraft does not bundle the background-removal models: they are large, and their licences and
upstreams are easier to honour when the file is fetched from its distributor. `scripts/fetch-models.*`
downloads exactly the files listed in `scripts/models.conf` (the same manifest the app reads from
`android/app/src/main/assets/models.conf`), verifies them and places them where the runtime expects.

Inference is always **local** (ONNX Runtime, on-device). No image ever leaves the phone, and no
account, token or payment is required.

## quick — U²-Net-p (`u2netp.onnx`)

| | |
|---|---|
| File | `u2netp.onnx` (~4.7 MB, 320 × 320 input) |
| Source | <https://huggingface.co/skillsafe-ai/u2netp> (mirror: <https://huggingface.co/Heliosoph/u2net-onnx>) |
| Upstream | Xuebin Qin et al., *U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection* — <https://github.com/xuebinqin/U-2-Net> |
| Licence | Apache-2.0 (the network); the ONNX conversion as distributed by rembg is MIT |
| Published SHA-256 | `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` |

## balanced — BiRefNet with the Swin-v1-tiny backbone (`BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx`)

| | |
|---|---|
| File | 224,005,088 bytes, 1024 × 1024 input |
| Source | <https://github.com/ZhengPeng7/BiRefNet/releases/tag/v1> |
| Licence | Apache-2.0 (see the repository's LICENSE) |
| Published checksum | none (the release publishes no digest; size is verified exactly) |

## hq — BiRefNet general (`BiRefNet-general-epoch_244.onnx`)

| | |
|---|---|
| File | 972,666,916 bytes, 1024 × 1024 input |
| Source | <https://github.com/ZhengPeng7/BiRefNet/releases/tag/v1> (mirror: <https://huggingface.co/onnx-community/BiRefNet-ONNX>) |
| Licence | Apache-2.0 |
| Published checksum | the GitHub release publishes none; the Hugging Face mirror publishes `58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c` for `onnx/model.onnx` |

## What PhotoCraft ships instead

The **Quick Remove** button in the editor does not need any model at all: it runs the engine's own
`layer.removeBackground` command (Select Subject + guided-filter edge refinement turned into a
layer mask). It works offline, on every device, and it is non-destructive. The ONNX models above
are the *high-quality* path and are optional.

## Verifying a checksum yourself

```sh
# from the model card / the distributor
sha256sum models/u2netp.onnx
```
`scripts/fetch-models.sh --verify` re-checks every model already on disk without downloading, and
exits non-zero if any file is missing, truncated or changed.
