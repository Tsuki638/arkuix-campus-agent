import { WorkspaceTheme as T } from './WorkspaceTheme';

// 使用原生矢量路径，避免依赖平台字体中的特殊图标字形。
@Component
export struct WorkspaceIcon {
  @Prop name: string = 'chat';
  @Prop iconSize: number = 20;
  @Prop color: string = T.secondary;

  private commands(): string {
    if (this.name === 'calendar') { return 'M4 5H20V21H4Z M4 10H20 M8 2V7 M16 2V7 M8 14H10 M14 14H16 M8 18H10'; }
    if (this.name === 'sidebar') { return 'M4 4H20V20H4Z M9 4V20 M6.5 8H6.6 M6.5 12H6.6'; }
    if (this.name === 'plus') { return 'M12 5V19 M5 12H19'; }
    if (this.name === 'search') { return 'M10.5 3.5A7 7 0 1 0 10.5 17.5A7 7 0 1 0 10.5 3.5 M16 16L21 21'; }
    if (this.name === 'plan') { return 'M9 4H5V21H19V4H15 M9 2H15V6H9Z M8 11L9 12L11 10 M13 11H16 M8 16L9 17L11 15 M13 16H16'; }
    if (this.name === 'settings') { return 'M4 7H9 M15 7H20 M4 17H13 M19 17H20 M9 4H15V10H9Z M13 14H19V20H13Z'; }
    if (this.name === 'arrow') { return 'M12 19V5 M6 11L12 5L18 11'; }
    if (this.name === 'right') { return 'M5 12H19 M13 6L19 12L13 18'; }
    if (this.name === 'chevron') { return 'M8 10L12 14L16 10'; }
    if (this.name === 'close') { return 'M6 6L18 18 M18 6L6 18'; }
    if (this.name === 'mic') { return 'M9 5A3 3 0 0 1 15 5V11A3 3 0 0 1 9 11Z M5 10V11A7 7 0 0 0 19 11V10 M12 18V22 M8 22H16'; }
    if (this.name === 'stop') { return 'M7 7H17V17H7Z'; }
    if (this.name === 'check') { return 'M5 12L10 17L19 7'; }
    if (this.name === 'trash') { return 'M4 6H20 M9 6V3H15V6 M6 6L7 21H17L18 6 M10 10V17 M14 10V17'; }
    if (this.name === 'book') { return 'M12 5C9 3 5 3 3 4V19C6 18 9 18 12 20C15 18 18 18 21 19V4C18 3 15 3 12 5Z M12 5V20'; }
    if (this.name === 'compass') { return 'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2 M16 8L14 14L8 16L10 10Z'; }
    if (this.name === 'spark') { return 'M12 3L14.5 9.5L21 12L14.5 14.5L12 21L9.5 14.5L3 12L9.5 9.5Z'; }
    if (this.name === 'sprout') { return 'M12 21V12 M12 15C6 15 3 11 3 6C9 6 12 9 12 15 M12 12C12 6 15 3 21 3C21 9 18 12 12 12 M7 21H17'; }
    if (this.name === 'tool') { return 'M14 4L10 8L16 14L20 10C21 14 18 17 14 16L7 23L2 18L9 11C8 7 11 3 14 4Z'; }
    if (this.name === 'terminal') { return 'M5 7L10 12L5 17 M13 17H20'; }
    return 'M4 4H20V17H9L4 21Z M8 9H16 M8 13H13';
  }

  build() {
    // Path 的命令坐标单位为 px；使用同样以 px 定义的视口映射到 vp，
    // 让图形与线宽一起缩放，避免高密度屏幕上的图标缩成小点。
    Shape() {
      Path({ width: '24px', height: '24px' }).commands(this.commands())
        .fill(Color.Transparent).stroke(this.color).strokeWidth('1.7px')
        .strokeLineCap(LineCapStyle.Round).strokeLineJoin(LineJoinStyle.Round)
    }.viewPort({ x: 0, y: 0, width: '24px', height: '24px' })
      .width(this.iconSize).height(this.iconSize).accessibilityLevel('no')
  }
}
