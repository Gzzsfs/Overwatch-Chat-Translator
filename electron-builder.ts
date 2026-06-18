/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: <> */
import type { Configuration } from 'electron-builder'
import { existsSync } from 'node:fs'

import {
  main,
  name,
  version,
  resources,
  description,
  displayName,
  author as rawAuthor,
} from './package.json'
import { getDevFolder } from './src/lib/electron-app/release/utils/path'

const author = rawAuthor?.name ?? rawAuthor
const currentYear = new Date().getFullYear()
const authorInKebabCase = author.replace(/\s+/g, '-')
const appId = `com.${authorInKebabCase}.${name}`.toLowerCase()
const artifactName = [`${name}-v${version}`, '-${os}.${ext}'].join('')
const extraResources = [
  {
    from: 'src/resources/build/icons',
    to: 'build/icons',
    filter: ['icon.ico', 'icon.icns'],
  },
  {
    from: 'ocr-service',
    to: 'ocr-service',
    filter: [
      '**/*',
      '!**/__pycache__/**',
      '!**/*.pyc',
      '!tests/**',
      '!README.md',
      '!.venv/**',
    ],
  },
  ...(existsSync('ocr-runtime')
    ? [
        {
          from: 'ocr-runtime',
          to: 'ocr-runtime',
          filter: [
            '**/*',
            '!**/__pycache__/**',
            '!**/*.pyc',
          ],
        },
      ]
    : []),
  ...(existsSync('ocr-models')
    ? [
        {
          from: 'ocr-models',
          to: 'ocr-models',
          filter: ['**/*', '!**/.cache/**', '!**/__pycache__/**', '!**/*.pyc'],
        },
      ]
    : []),
]

export default {
  appId,
  productName: displayName,
  copyright: `Copyright © ${currentYear} ${author}`,
  npmRebuild: false,
  directories: {
    app: getDevFolder(main),
    output: `dist/v${version}`,
  },
  extraResources,
  mac: {
    artifactName,
    icon: `${resources}/build/icons/icon.icns`,
    category: 'public.app-category.utilities',
    target: ['zip', 'dmg', 'dir'],
  },
  linux: {
    artifactName,
    category: 'Utilities',
    synopsis: description,
    target: ['AppImage', 'deb', 'pacman', 'freebsd', 'rpm'],
  },
  win: {
    artifactName,
    icon: `${resources}/build/icons/icon.ico`,
    signAndEditExecutable: false,
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: displayName,
  },
} satisfies Configuration
