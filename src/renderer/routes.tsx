import { GameOverlayScreen } from './screens/game-overlay'
import { OverwatchTranslatorScreen } from './screens/overwatch-translator'
import { RoiSelectorScreen } from './screens/roi-selector'

export function AppRoutes() {
  if (window.location.hash.includes('/selector')) {
    return <RoiSelectorScreen />
  }

  if (window.location.hash.includes('/game')) {
    return <GameOverlayScreen />
  }

  return <OverwatchTranslatorScreen />
}
