import {
  Cloud,
  Download,
  ExternalLink,
  Folder,
  GitBranch,
  Globe,
  Lock,
  Plus,
  Puzzle,
  RefreshCw,
  Star,
  Trash2,
  User
} from 'lucide-react'

// Iconos que pueden usar las extensiones por nombre. Lista cerrada: así no se empaqueta
// todo lucide. Si una extensión necesita otro, añádelo aquí y documéntalo.
const ICONS = {
  cloud: Cloud,
  download: Download,
  'external-link': ExternalLink,
  folder: Folder,
  'git-branch': GitBranch,
  globe: Globe,
  lock: Lock,
  plus: Plus,
  puzzle: Puzzle,
  refresh: RefreshCw,
  star: Star,
  trash: Trash2,
  user: User
}

export const extIcon = (name) => ICONS[name] ?? Puzzle
