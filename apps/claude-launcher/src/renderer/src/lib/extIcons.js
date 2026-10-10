import {
  ArrowLeft,
  Bug,
  Calendar,
  Cloud,
  Download,
  ExternalLink,
  Folder,
  GitBranch,
  Globe,
  Layers,
  LayoutDashboard,
  Play,
  Link,
  ListTodo,
  Lock,
  Plus,
  Puzzle,
  RefreshCw,
  SquareKanban,
  Star,
  Trash2,
  User,
  Users
} from 'lucide-react'
import { ClaudeIcon, GithubIcon, MicrosoftAzure } from './brandIcons'

// Iconos que pueden usar las extensiones por nombre. Lista cerrada: así no se empaqueta
// todo lucide. Si una extensión necesita otro, añádelo aquí y documéntalo.
const ICONS = {
  'arrow-left': ArrowLeft,
  azure: MicrosoftAzure,
  bug: Bug,
  calendar: Calendar,
  claude: ClaudeIcon,
  cloud: Cloud,
  download: Download,
  'external-link': ExternalLink,
  folder: Folder,
  'git-branch': GitBranch,
  github: GithubIcon,
  globe: Globe,
  kanban: SquareKanban,
  layers: Layers,
  'layout-dashboard': LayoutDashboard,
  link: Link,
  'list-todo': ListTodo,
  lock: Lock,
  play: Play,
  plus: Plus,
  puzzle: Puzzle,
  refresh: RefreshCw,
  star: Star,
  trash: Trash2,
  user: User,
  users: Users
}

export const extIcon = (name) => ICONS[name] ?? Puzzle
