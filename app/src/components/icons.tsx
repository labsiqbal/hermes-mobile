/**
 * Ikon app = Lucide (MIT) dibungkus default lokal: stroke 1.8, aria-hidden,
 * size default 18px, warna ikut currentColor. Nama export lama dipertahankan
 * supaya call sites tidak berubah; tambah ikon baru lewat tabel wrap di bawah.
 */
import {
  Activity,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Clock,
  File,
  Image,
  LayoutGrid,
  Menu,
  MessageSquare,
  Monitor,
  Plug,
  Plus,
  Search,
  Server,
  Settings,
  Unplug,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";

export interface IconProps {
  size?: number;
}

function wrap(Icon: LucideIcon, size = 18) {
  return function AppIcon(props: IconProps) {
    return <Icon size={props.size ?? size} strokeWidth={1.8} aria-hidden="true" />;
  };
}

export const BoardIcon = wrap(LayoutGrid);
export const ChevronLeftIcon = wrap(ChevronLeft);
export const SearchIcon = wrap(Search);
export const MenuIcon = wrap(Menu);
export const ChatIcon = wrap(MessageSquare);
export const BotIcon = wrap(Bot);
export const RunsIcon = wrap(Activity);
export const ConnectionsIcon = wrap(Plug);
export const UsersIcon = wrap(Users);
export const SettingsIcon = wrap(Settings);
export const DisconnectIcon = wrap(Unplug);
export const ServerIcon = wrap(Server);
export const MonitorIcon = wrap(Monitor);
export const PlusIcon = wrap(Plus);
export const ChevronRightIcon = wrap(ChevronRight);
export const ChevronDownIcon = wrap(ChevronDown);
export const ClockIcon = wrap(Clock);
export const ArrowUpIcon = wrap(ArrowUp);
export const StopIcon = wrap(CircleStop);
export const FileIcon = wrap(File);
export const ImageIcon = wrap(Image);
export const XIcon = wrap(X);
/** Avatar grup (baris room / daftar grup). */
export const GroupIcon = wrap(UsersRound, 16);
