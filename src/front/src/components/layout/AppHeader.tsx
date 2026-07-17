interface AppHeaderProps {
  /** Right-side content (e.g., back button, user info) */
  children?: React.ReactNode;
  /** If provided, the logo/title becomes clickable */
  onLogoClick?: () => void;
}

export function AppHeader({ children, onLogoClick }: AppHeaderProps) {
  const LogoContent = (
    <>
      <span className="text-xl">🎵</span>
      <span className="font-semibold text-foreground">Fluent Audio Split</span>
    </>
  );

  return (
    <header className="border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {onLogoClick ? (
          <button onClick={onLogoClick} className="flex items-center gap-2 hover:opacity-80">
            {LogoContent}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {LogoContent}
          </div>
        )}
        {children && <div className="flex items-center gap-4">{children}</div>}
      </div>
    </header>
  );
}
