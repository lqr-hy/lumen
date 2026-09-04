import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  installStylePack,
  installUserSkill,
  listStylePacks,
  listUserExtensions,
  removeUserExtension,
  resolveStylePack,
  setUserExtensionEnabled,
} from '../electron/runtime/user-extensions.mjs'
import {
  configureSkillRuntime,
  invalidateSkillCache,
  listPublicSkills,
} from '../electron/runtime/skills.mjs'

const appRoot = path.resolve(import.meta.dirname, '..')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-user-extensions-'))
const sources = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-extension-sources-'))

try {
  configureSkillRuntime({ appRoot, resourcesPath: appRoot, userDataPath: root, isPackaged: false })

  const skillRoot = path.join(sources, 'campaign-copy-style')
  await fs.mkdir(path.join(skillRoot, 'references'), { recursive: true })
  await fs.writeFile(
    path.join(skillRoot, 'SKILL.md'),
    [
      '---',
      'name: campaign-copy-style',
      'description: 为活动设计提供简洁的文案层级规则。',
      '---',
      '',
      '# 活动文案',
      '',
      '保持标题、利益点与行动按钮三层信息。',
    ].join('\n'),
  )
  await fs.writeFile(path.join(skillRoot, 'references', 'rules.md'), '# Rules')
  await installUserSkill(skillRoot)
  invalidateSkillCache()
  let skills = await listPublicSkills()
  const installedSkill = skills.find((skill) => skill.name === 'campaign-copy-style')
  assert.equal(installedSkill?.source, 'user')
  assert.equal(installedSkill?.executable, false)

  await setUserExtensionEnabled('skills', 'campaign-copy-style', false)
  invalidateSkillCache()
  skills = await listPublicSkills()
  assert.equal(
    skills.some((skill) => skill.name === 'campaign-copy-style'),
    false,
  )
  assert.equal((await listUserExtensions()).skills[0].enabled, false)

  const unsafeSkillRoot = path.join(sources, 'unsafe-runtime')
  await fs.mkdir(path.join(unsafeSkillRoot, 'runtime'), { recursive: true })
  await fs.writeFile(
    path.join(unsafeSkillRoot, 'SKILL.md'),
    ['---', 'name: unsafe-runtime', 'description: 不安全测试能力。', '---', '# unsafe'].join('\n'),
  )
  await fs.writeFile(path.join(unsafeSkillRoot, 'runtime', 'entry.mjs'), 'export default 1')
  await assert.rejects(
    () => installUserSkill(unsafeSkillRoot),
    /不允许包含 Runtime|不允许包含可执行文件/,
  )

  const styleFile = path.join(sources, 'festival-red.json')
  await fs.writeFile(
    styleFile,
    JSON.stringify({
      id: 'festival-red',
      name: '节庆红',
      version: '1.0.0',
      description: '高对比红金活动主题',
      colors: { primary: '#e11d48', secondary: '#f59e0b', background: '#7f1d1d', text: '#ffffff' },
      constraints: ['保持红金主色'],
    }),
  )
  await installStylePack(styleFile)
  const packs = await listStylePacks()
  assert(packs.some((pack) => pack.id === 'bili-live-ranking' && pack.source === 'built-in'))
  assert(packs.some((pack) => pack.id === 'festival-red' && pack.source === 'user'))
  const resolved = await resolveStylePack('festival-red')
  assert.equal(resolved.colors.primary, '#e11d48')

  await setUserExtensionEnabled('stylePacks', 'festival-red', false)
  await assert.rejects(() => resolveStylePack('festival-red'), /不存在或已停用/)
  await removeUserExtension('stylePacks', 'festival-red')
  assert.equal(
    (await listStylePacks()).some((pack) => pack.id === 'festival-red'),
    false,
  )

  console.log(
    JSON.stringify(
      {
        userSkillInstall: true,
        userSkillDisable: true,
        executableSkillRejected: true,
        stylePackInstall: true,
        stylePackDisable: true,
        builtInStylePack: true,
      },
      null,
      2,
    ),
  )
} finally {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(sources, { recursive: true, force: true })
}
