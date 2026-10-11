// Logos de marcas (Claude, GitHub, IDEs…) en versión monocroma: usan currentColor, como lucide.
import {
  AndroidIcon,
  Bitbucket,
  ClaudeIcon,
  Clion,
  CursorIcon,
  Datagrip,
  GithubIcon,
  Goland,
  IntellijIdea,
  MicrosoftAzure,
  Phpstorm,
  Pycharm,
  Rider,
  Rubymine,
  SublimetextIcon,
  VisualStudio,
  VisualStudioCode,
  Webstorm,
  WindsurfIcon
} from '@dev.icons/react/mono'
import { Code } from 'lucide-react'

export { Bitbucket, ClaudeIcon, GithubIcon, MicrosoftAzure }

// Por id de IDE (ver src/main/ide.js). Los que no tienen logo usan un icono genérico.
const IDE_ICONS = {
  code: VisualStudioCode,
  cursor: CursorIcon,
  windsurf: WindsurfIcon,
  idea: IntellijIdea,
  webstorm: Webstorm,
  pycharm: Pycharm,
  rider: Rider,
  goland: Goland,
  phpstorm: Phpstorm,
  clion: Clion,
  rubymine: Rubymine,
  datagrip: Datagrip,
  studio: AndroidIcon,
  subl: SublimetextIcon,
  devenv: VisualStudio,
  'code-insiders': VisualStudioCode
}

export const ideIcon = (id) => IDE_ICONS[id] ?? Code
