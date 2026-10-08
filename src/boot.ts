/** Boot — force RTL for Arabic devices before React registers. */
import {I18nManager} from 'react-native';
import {getLang} from './src/i18n';

if (getLang() === 'ar' && !I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}
