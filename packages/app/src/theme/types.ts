import { MantineThemeOverride } from '@mantine/core';

export type ThemeName = 'hyperdx' | 'clickstack';

export interface ThemeConfig {
  name: ThemeName;
  displayName: string;
  mantineTheme: MantineThemeOverride;
  Logo: React.ComponentType<{ size?: 'sm' | 'md' | 'lg' | 'xl' }>;
  Icon: React.ComponentType<{ size?: number }>;
  cssClass: string; // Applied to html element for CSS variable scoping
}
