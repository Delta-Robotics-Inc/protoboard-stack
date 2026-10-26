/**
 * Offering the Protoboard colour themes (PB-900): once, after the extension
 * is installed, a notification offers Protoboard Dark and Protoboard Light.
 * Choosing one sets `workbench.colorTheme` (the user's setting, as the theme
 * picker does); dismissing it, or "No Thanks", is remembered too, so it never
 * asks again. The views follow whatever theme VS Code applies either way.
 */
import * as vscode from "vscode";

export const THEME_OFFERED_KEY = "protoboard.themeOffered";
export const PROTOBOARD_THEMES = { dark: "Protoboard Dark", light: "Protoboard Light" } as const;

export async function offerThemes(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(THEME_OFFERED_KEY)) return;
  const current = vscode.workspace.getConfiguration("workbench").get<string>("colorTheme") ?? "";
  // asked once, whatever the answer (closing the notification counts)
  await context.globalState.update(THEME_OFFERED_KEY, true);
  if (current.startsWith("Protoboard")) return;
  const dark = vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Light && vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.HighContrastLight;
  const first = dark ? PROTOBOARD_THEMES.dark : PROTOBOARD_THEMES.light;
  const second = dark ? PROTOBOARD_THEMES.light : PROTOBOARD_THEMES.dark;
  const pick = await vscode.window.showInformationMessage("Try the Protoboard colour theme?", `Use ${first}`, `Use ${second}`, "No Thanks");
  if (!pick || pick === "No Thanks") return;
  const theme = pick.slice("Use ".length);
  await vscode.workspace.getConfiguration("workbench").update("colorTheme", theme, vscode.ConfigurationTarget.Global);
}
