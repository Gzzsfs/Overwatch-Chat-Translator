export const ENVIRONMENT = {
  IS_DEV: process.env.NODE_ENV === 'development',
}

export const PLATFORM = {
  IS_MAC: process.platform === 'darwin',
  IS_WINDOWS: process.platform === 'win32',
  IS_LINUX: process.platform === 'linux',
}

export const RUNTIME_DOCS = [
  {
    label: 'Riot 英雄联盟文档',
    href: 'https://developer.riotgames.com/docs/lol?from=20423&from_column=20423',
  },
  {
    label: 'Riot 开发者政策',
    href: 'https://developer.riotgames.com/policies/general',
  },
  {
    label: 'Hextechdocs LCU 接口',
    href: 'https://hextechdocs.dev/getting-started-with-the-lcu-api/',
  },
  {
    label: 'Hextechdocs WebSocket',
    href: 'https://hextechdocs.dev/getting-started-with-the-lcu-websocket/',
  },
  {
    label: 'LCU 社区镜像',
    href: 'https://lcu.vivide.re/',
  },
] as const

export const RIOT_LEGAL_BOILERPLATE =
  '本产品未获得 Riot Games 官方认可，也不代表 Riot Games 或任何参与 Riot Games 作品制作、发行与运营人员的观点。Riot Games 及其相关名称、作品与标识均属于 Riot Games, Inc. 的商标或注册商标。'
