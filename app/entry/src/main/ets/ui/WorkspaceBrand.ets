import { WorkspaceIcon } from './WorkspaceIcon';
import { WorkspaceTheme as T } from './WorkspaceTheme';

@Component
export struct WorkspaceBrand {
  @Prop diameter: number = 64;

  build() {
    Stack() {
      Circle().width(this.diameter).height(this.diameter).fill(T.accentSoft)
      Circle().width(this.diameter * 0.79).height(this.diameter * 0.79)
        .fill('#F7FAF4').stroke('#D8E5D4').strokeWidth(1)
      WorkspaceIcon({ name: 'sprout', iconSize: this.diameter * 0.43, color: T.accent })
    }.width(this.diameter).height(this.diameter).accessibilityLevel('no')
  }
}
