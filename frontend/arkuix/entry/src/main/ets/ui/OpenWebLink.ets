import common from '@ohos.app.ability.common';
import deviceInfo from '@ohos.deviceInfo';
import { isWebLink } from './ReplyFormatting';

export async function openWebLink(ui: UIContext, url: string): Promise<void> {
  if (!isWebLink(url)) { return; }
  try {
    if ((deviceInfo?.osFullName ?? '').startsWith('Android')) {
      const android = await import('../platform/network/AndroidLinkBridge');
      if (await android.openAndroidLink(url)) { return; }
    } else {
      const context: common.UIAbilityContext = ui.getHostContext() as common.UIAbilityContext;
      try {
        await context.openLink(url);
      } catch {
        await context.startAbility({ action: 'ohos.want.action.viewData', entities: ['entity.system.browsable'], uri: url });
      }
      return;
    }
  } catch { /* 使用统一的打开失败提示。 */ }
  ui.getPromptAction().showToast({ message: '无法打开网页，可以复制链接后重试。' });
}
