// 页面将系统返回事件交给工作台，先关闭抽屉或返回对话，再交由系统退出。
export class WorkspaceNavigation {
  handleBack: () => boolean = () => false;
}
