export interface OverlayProps {
  gameId: string;
  refresh?: () => Promise<void>;
}
