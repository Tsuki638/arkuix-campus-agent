import bridge from '@arkui-x.bridge';

let browserBridge: bridge.BridgeObject | undefined;

export async function openAndroidLink(url: string): Promise<boolean> {
  browserBridge = browserBridge ?? bridge.createBridge('campus.browser');
  return await browserBridge.sendMessage(url) === true;
}
