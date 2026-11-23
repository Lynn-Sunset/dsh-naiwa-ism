/* 奶蛙主义控制条 · 浏览器模块
 *
 * 本文件是 classic script（页面按图拼接后通过 script 标签加载）：
 *   - 不能出现 import / export 语句；
 *   - 不能有 JSX（没有构建步骤），只用 React.createElement；
 *   - 顶层只做一件事：向 window.__ModuleLoader__ 注册 lazy factory。
 *
 * 契约：factory(require) 返回 { inject, apply }；inject 是客户端服务名数组。
 * 点击经 ctx.remote.commands.execute(sessionId, '/naiwa …', []) 落到 Host 命令，
 * 与 naiwa_config 工具共用同一实现（Host 侧 lib/control.js 的 applyOperation）。
 * 本文件只做控制类动作：不发网络请求、不读写别的插件 DOM、不在挂载时发命令。
 */

if (globalThis.window && globalThis.window.__ModuleLoader__) {
  globalThis.window.__ModuleLoader__.load({
    id: '@local/dsh-naiwa-ism',
    factory(require) {
      const React = require('react')
      const h = React.createElement

      const NS = 'naiwa-ism'
      const SLOT = 'conversation.input.dock'
      const CACHE_KEY = 'naiwa-ism:state'
      const STRENGTHS = ['off', 'naiwa']
      const LANGUAGES = ['auto', 'zh', 'en']
      const DEFAULT_VIEW = { strength: 'naiwa', resident: true, language: 'auto', spell: '' }

      /* 奶蛙叠层皮肤（theme.overrideTokens）：14 个 --dsw-* 键 × {light,dark}。
       * 逐字来自 design/theme-spec.md §1（rev2）；本插件只叠这一层，不注册主题、不调 setTheme。 */
      const SKIN_KEY = 'naiwa-ism:skin'
      const SKIN_SOURCE = 'naiwa-ism'

      function pair(light, dark) {
        return Object.freeze({ light: light, dark: dark })
      }

      const SKIN_PAIRS = Object.freeze({
        '--dsw-alias-bg-base': pair('#FBF3DC', '#14140F'),
        '--dsw-alias-bg-layer-1': pair('#FFFCF0', '#1B1B14'),
        '--dsw-alias-bg-layer-2': pair('#F5EBCB', '#24241A'),
        '--dsw-alias-bg-overlay': pair('#FFF7E6', '#1F1F16'),
        '--dsw-alias-border-l1': pair('#E8DCB8', '#35352A'),
        '--dsw-alias-border-l2': pair('#D9C99C', '#45452F'),
        '--dsw-alias-brand-primary': pair('#8A6A00', '#F5C518'),
        '--dsw-alias-label-primary': pair('#1A1A1A', '#F4EDD6'),
        '--dsw-alias-label-secondary': pair('#5C5443', '#B9B098'),
        '--dsw-alias-state-error-primary': pair('#B33225', '#FF7A6B'),
        '--dsw-alias-state-idle-primary': pair('#6F6751', '#9C9782'),
        '--dsw-alias-state-success-primary': pair('#35704A', '#7DD68F'),
        '--dsw-alias-state-warn-primary': pair('#8A5F00', '#E8B84B'),
        '--dsw-specific-sidebar-fill': pair('#F2E7C4', '#11110C'),
      })

      /* 中英字典：键集必须完全一致（G8 断言）。 */
      const DICTS = {
        zh: {
          name: '奶蛙',
          'strength.off': '关闭',
          'strength.naiwa': '奶蛙',
          'resident.on': '常驻：开',
          'resident.off': '常驻：关',
          'language.auto': '跟随',
          'language.zh': '中文',
          'language.en': 'EN',
          'skin.group': '皮肤',
          'skin.on': '奶蛙',
          'skin.off': '关闭',
          sync: '同步',
          'status.unknown': '未同步',
          'status.pending': '同步中…',
          'status.failed': '失败',
          'aria.group': '奶蛙控制条',
          'title.strength': '档位：关闭=不注入人格；奶蛙=默认注入。改完下一轮生效',
          'title.resident': '常驻：关掉后本 profile 不再注入人格段落',
          'title.language': '回答语言',
          'title.skin': '皮肤：奶蛙配色；深色外观下自动使用奶蛙夜配色',
          'title.sync': '读取 Host 当前设置',
          'label.strength': '档位',
          'label.resident': '常驻',
          'label.language': '语言',
          'label.skin': '皮肤',
          'label.sound': '音效',
          'sound.on': '开',
          'sound.off': '关',
          'title.sound': '每轮回答结束后随机播放奶蛙笑声',
        },
        en: {
          name: 'Naiwa',
          'strength.off': 'Off',
          'strength.naiwa': 'Naiwa',
          'resident.on': 'Resident: on',
          'resident.off': 'Resident: off',
          'language.auto': 'Auto',
          'language.zh': '中文',
          'language.en': 'EN',
          'skin.group': 'Skin',
          'skin.on': 'Naiwa',
          'skin.off': 'Off',
          sync: 'Sync',
          'status.unknown': 'Not synced',
          'status.pending': 'Syncing…',
          'status.failed': 'Failed',
          'aria.group': 'Naiwa control bar',
          'title.strength': 'Strength: applies on the next turn',
          'title.resident': 'Resident: off stops persona injection in this profile',
          'title.language': 'Answer language',
          'title.skin': 'Skin: naiwa palette; dark appearance uses the naiwa night palette',
          'title.sync': 'Read the Host settings',
          'label.strength': 'Strength',
          'label.resident': 'Resident',
          'label.language': 'Language',
          'label.skin': 'Skin',
          'label.sound': 'Sound',
          'sound.on': 'On',
          'sound.off': 'Off',
          'title.sound': 'Play a random Naiwa laugh after each turn',
        },
      }

      /* ---------------- localStorage 缓存 ---------------- */

      function readCache() {
        try {
          const store = globalThis.localStorage
          if (!store) return null
          const raw = store.getItem(CACHE_KEY)
          if (typeof raw !== 'string' || raw.length === 0) return null
          const parsed = JSON.parse(raw)
          if (parsed === null || typeof parsed !== 'object') return null
          return {
            strength: STRENGTHS.includes(parsed.strength) ? parsed.strength : 'naiwa',
            resident: parsed.resident !== false,
            language: LANGUAGES.includes(parsed.language) ? parsed.language : 'auto',
            spell: typeof parsed.spell === 'string' ? parsed.spell : '',
            lastText: typeof parsed.lastText === 'string' ? parsed.lastText : '',
          }
        } catch (_error) {
          return null
        }
      }

      function writeCache(view, text) {
        try {
          const store = globalThis.localStorage
          if (!store) return
          store.setItem(CACHE_KEY, JSON.stringify({
            strength: view.strength,
            resident: view.resident,
            language: view.language,
            spell: view.spell,
            lastText: typeof text === 'string' ? text : '',
            updatedAt: Date.now(),
          }))
        } catch (_error) {
          /* 缓存写不进去不影响控制；Host 状态才是真相。 */
        }
      }

      /* ---------------- 皮肤叠层状态与 localStorage 重放 ---------------- */

      /* 每个插件实例一份：bound=已拿到 theme 服务；on=层已装上；layer=disposer。 */
      const skin = { bound: false, on: false, layer: null, theme: null }

      /* 组件订阅用的小发布器：available 由 attach 置真，on 跟随层状态。 */
      const skinBridge = {
        available: false,
        on: false,
        listeners: [],
        subscribe: function (listener) {
          skinBridge.listeners.push(listener)
          return function () {
            const index = skinBridge.listeners.indexOf(listener)
            if (index >= 0) skinBridge.listeners.splice(index, 1)
          }
        },
        publish: function () {
          const listeners = skinBridge.listeners.slice()
          for (let index = 0; index < listeners.length; index += 1) {
            try {
              listeners[index](skinBridge.on)
            } catch (_error) {
              /* 单个订阅者出错不阻塞其余。 */
            }
          }
        },
        toggle: function () {
          if (!skin.bound) return false
          return setSkin(skin, skin.theme, skin.on !== true, undefined)
        },
      }

      /* manager 裁决（C3′，2026-11-20 contract rev6）：存储缺失按 'on'（默认开启）。
       * design/theme-spec.md §2.3 的旧默认 'off' 被该裁决覆盖；读出异常同样回落 'on'。 */
      function readStored(storage) {
        try {
          const store = storage === undefined ? globalThis.localStorage : storage
          if (store === null || store === undefined || typeof store.getItem !== 'function') return 'on'
          const raw = store.getItem(SKIN_KEY)
          return raw === 'off' ? 'off' : 'on'
        } catch (_error) {
          return 'on'
        }
      }

      function writeStored(storage, value) {
        try {
          const store = storage === undefined ? globalThis.localStorage : storage
          if (store === null || store === undefined || typeof store.setItem !== 'function') return false
          store.setItem(SKIN_KEY, value)
          return true
        } catch (_error) {
          return false
        }
      }

      /* 皮肤开启时，将两态背景样式挂载到页面。 */
      const BACKDROP_ID = 'naiwa-ism-backdrop'
      /* 四段合成短音随客户端内嵌。 */
      const LAUGH_CLIPS = ['data:audio/wav;base64,UklGRuQSAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YcASAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH9/f39/f39/f39/f4CAgICAgYGBgYGBgoKCgYGBgYGBgICAf39/fn5+fn5+fn5+fn9/f4CAgYGBgoKDg4ODg4ODg4KCgoGAgH9/fn19fXx8fHx8fHx9fX5/f4CBgoODhISFhYWFhYWEhIOCgYGAf359fHt6enp5eXp6e3t8fX5/gYKDhIWGh4eIiIiIh4aGhIOCgH9+fHt6eXh3d3d3d3h5ent8foCBg4WGiImKi4uLi4qKiIeGhIKAfnx6eHd2dXRzc3R0dXZ4enx+gIOFh4mLjI2Ojo6OjYyLiYeEgn99enh2dHJxcHBwcHFzdXd5fH+ChIeKjI6QkZKSkpGQjoyKh4SBfnp3dXJwbm1sbGxtb3Fzdnl8gIOHio2QkpSVlpaWlJOQjoqHg397eHRxbmxqaWhoaWpsb3J2eX6ChoqOkZSXmZqampmXlZKOioaCfXh0cG1pZ2VkZGRmaGtucnZ7gIWJjpKWmZudnp6dnJmWko6JhH96dXBraGRiYWBgYWNmam5zeH2DiI6Tl5ueoKKioqCempaSjYeBe3Vwa2ZiX11cXF1fYmVqb3V7gYeNk5idoKOlpqakop+blpCKhH13cGplYV1aWVhZW11hZmtxeH+FjJOZnqKmqKmpqKajn5mTjYZ/eHFqZF9bWFZVVVdZXWJobnV8hIuSmZ+kqKusrayqp6Kdl5CIgXlyamReWVZTUlJTVlpfZWtzeoKKkpmfpaqtr7CvraqmoJqSi4J6cmtkXVhUUU9PUFNXXGJpcHmBiZGZoKarr7GysrCtqKOclIyEe3NrY11XUk9NTU5QVFlgZ293gImRmaCnrLCztLSyr6qlnpaOhXxza2NcVlFOS0tMTlJXXmVtdn+IkZmhqK2xtLa1tLGspp+Xj4Z9dGtjW1VQTUpKS01RVl1kbXZ/iJGZoaiusrW3trWxraegmI+GfXNrYltVUExKSUpNUVZdZG12f4iRmqKprrO2t7e1sq2noJiPhnxzamJbVE9MSklKTVFWXWVtdn+Jkpqiqa6ztbe2tLGspp+XjoV7cmphWlRPTEpKS05SV15mbneAipOboqmusrW2tbOwq6WdlYyDenFpYVpUUE1LS0xPVFlgaHB5gouTnKOprrK0tbSxrqmim5OLgnlwaGFaVVBOTE1OUVZcYmpye4SMlJyjqa2wsrOyr6umoJiRiIB3b2dgWlVST05PUVRZX2VtdX2GjpWdo6isr7Cwr6yoo5yVjoZ9dW5nYFtWU1FRUlRYXWJpcHiAiI+WnaOnq62urauopJ+ZkoqDe3RtZmBcWFVUVFZYXGFmbXR7goqRl52ipqiqqqmnpKCblY6HgHlybGZhXVpYV1haXGBla3F3foWLkpecoaSmp6elo6CblpCKhH13cWtmYl9cW1tcXmFlam91e4GHjZKXnJ+ho6OjoZ6bl5KMh4F7dXBrZ2NhX19fYGNmam5zeH6EiY6Tl5qdnp+fnpyZlpKNiIN+eXRva2hmZGNjY2Vna25zd3yBhoqPkpaYmpubm5mXlZGNiYWAfHdzcGxqaGdnZ2hqbG9zd3t/g4eLj5KUlpeYl5aVk5CNiYaCfnp2c3BubGtqa2ttbnF0d3p+gYWIi46QkpOUlJOSkI6MiYaDf3x5dnRycG9ubm9wcXN1eHp9gIOGiIuNjo+QkJCPjoyKiIWDgH57eXd1dHNycnJzdHV3eXt9f4KEhoiKi4yMjYyMi4qIh4WDgX99e3l4d3Z1dXV2dnd5enx9f4GDhIaHiImJiYmJiIiGhYSCgX9+fXt6eXl4eHh4eXp6e31+f4CCg4SFhoaHh4eGhoWFhIOCgYB/fn18e3t7e3t7e3x8fX5+f4CBgoKDhISEhISEhISDg4KBgYB/f35+fX19fX19fX1+fn9/gICBgYGCgoKCgoKCgoKCgYGBgICAf39/f35+fn5+fn9/f3+AgICAgIGBgYGBgYGBgYGBgYCAgICAgICAf39/f39/f4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB/f39/gICAgICAgICBgYGBgYGBgYGAgICAf39/f39/f39/f3+AgICBgYGCgoKCgoKBgYGAgH9/fn5+fn5+fn5+f4CAgYGCgoODg4ODg4KCgYB/f359fXx8fHx9fX5+f4CBgoOEhIWFhYSEg4KBgH9+fXx7e3p6e3t8fX5/gYKDhIWGh4eGhoWEg4GAfn17enl5eHh5ent8fn+Bg4WGh4iJiYiIh4WDgn99e3p4d3Z2dnd4eXt9gIKEhoiKi4uLi4qIhoSBf3x6eHZ1dHR0dXZ4e32Ag4aIi4yNjo6Ni4mHhIF+e3h1c3JxcXJzdXh7foGFiIuNj5CRkI+NioeEgHx4dXJwb25ub3F0d3t/g4eLjpCSk5OTkY6Lh4N+enZyb21ra2xtcHN3e4CFiY6RlJaWlpWSj4uHgnx4c29saWhoaWtvc3d9goeMkZWXmZqZl5SQi4WAenRva2hmZWVnam5zeX+Fi5CVmZudnJuYlI+Kg313cWtnZGJiY2VpbnR6gYiOlJmdn6CfnZmUjoiBenNsZ2NgX19hZWlvdn2FjJOZnaGio6GemZOMhX11bmhjX1xcXWBkanF5gYmRmJ2ipaalop6YkYmBeXFpY15bWVlcYGVsdH2FjpadoqaoqKajnZaOhn10a2ReWVdWWFtgZ294gYuUm6Knqquqp6Kbk4qBd25lXllVVFRXXGJqc32HkZqhp6utraumoJiPhXtxaF9ZVFJSVFheZm95g46XoKesr7CuqqSdk4l/dGphWlRQT1BUWmFqdX+KlJ6mrLCysa6ooZiOg3htY1tUUE5OUVZdZnB7h5Kcpayws7OxrKWckod7cGVcVVBNTE5TWWJsd4OPmaOrsLS1s6+ooJaKf3NoXlZQTEtMUFZfaXSAi5ehqbC0trWxq6OZjoJ2a2BXUExKS05UXGVxfImUn6ivtLa2s62mnJGFeW1iWVFMSkpMUlljbnqGkp2mrrS2t7SvqJ6UiHxwZFtTTUpJS1BXYGt3g4+bpa2ztre1sKmglop+cmZcVE5KSUtPVl9pdYGNmaOrsrW3tbGropiMgHRoXlZPS0pLT1VeaHN/i5ehqrC1trWxq6OZjoJ2amBXUExKS09VXWdyfoqVn6ivs7W0saujmo+Dd2xhWVJNS0xPVV1mcX2Ik56mrbK0s7Cro5qPhHhtY1pUT01NUFZdZnF8h5KcpaywsrKvqqOaj4R5bmRcVVFPT1JXXmdxfIeRm6OqrrCwraihmY+Eem9mXVdTUVFTWF9ocXyGkJqiqKyurqynoJiOhHpwZ19ZVVNTVlphaXJ8hpCZoKaqrKyppZ6WjYR6cWhhW1dVVVhcY2pzfYaPmJ+kqKqpp6KclYyDenFpYl1ZWFhbX2VsdX2Gj5edoqanp6SgmpOLgnpxamRfXFpbXWJnbnZ+h4+WnKCjpKShnZeRiYF5cmtlYV5dXmBlanF4f4eOlZqeoaGhnpqVjoeAeXJsZ2NhYGFkaG1zeoGHjpSYnJ6enZuXkoyGf3hybWhlY2NkZ2tvdXuCiI6Tl5qbm5qYlI+KhH54c25qaGZmZ2pucnd9g4iNkpWXmJiXlJGNiIJ9eHNvbGppaWttcXV5foOIjZCTlZWVlJGOioaBfHh0cW5sbGxucHN3e4CEiIyPkZKTkpGOi4iEgHx4dXJwb29vcXN2eX2BhYiLjY+QkI+Oi4mFgn97eHZ0cnJycnR2eXt/goWHioyNjY2Mi4mGhIF+e3l3dXR0dHV3eHt9gIKFh4iKi4uKioiGhIKAfnx6eHd3dnd4eXt8foCChIaHiIiIiIeGhIOBf318e3p5eXl5ent8fn+BgoSFhoaGhoaFhIOCgH9+fXx7e3p7e3x9fn+AgYKDhISFhYSEg4OCgYB/fn19fHx8fH19fn+AgIGCgoODg4ODgoKBgYCAf35+fn5+fn5+f39/gICBgYKCgoKCgoGBgYCAgH9/f39/f39/f3+AgICAgYGBgYGBgYGBgICAgICAf39/f39/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB/f39/f39/f3+AgICAgICBgYGBgYGBgYGBgYGAgICAf39/f35+fn5+fn9/f4CAgIGBgoKCgoKCgoKCgoGBgIB/f35+fX19fX19fX1+fn+AgIGCgoOEhISEhISDg4KCgYB/fn19fHt7e3t7e3x9fX5/gIKDhISFhoaGhoaFhYSDgYB/fnx7enp5eXl5eXp7fH1/gIKDhYaHiIiJiYiIh4WEgoF/fXt6eHd3dnZ2d3h5e3x+gIKEhoiJiouLi4uKiYeFg4F/fHp4dnV0c3NzdHV3eXt9gIOFiIqMjY6Ojo6Ni4mHhIJ/fHl2dHJxcHBwcXN0d3p9gIOGiYyOkJGSkpGQjouJhYJ/e3h1cnBubW1tbnBydXh8gISHi46Rk5SVlZSTkY6Kh4J+enZyb21raWlqa21wc3d7gISJjZCUlpiZmZiWk5CMh4N+eXRwbWpnZmZmaGptcXZ7gIWKj5OXmZucnJuZlpKNiIN9eHJuamZkYmJjZWdrcHV6gIaMkZaanZ+gn56bmJOOiYJ8dnBrZmNgX19gYmVpbnR7gYiOlJmdoKKjo6GempWPiIJ7dG5oY19dW1tdX2NobnR7goqQl5yhpKanpqSgm5aPiIB5cmtlYFxZWFhaXWFnbnV8hIyTmqCkp6mqqKainJaPh393b2hhXFhWVVVYW2BnbnZ+h4+WnaOoq6ysq6ejnZWOhXx0bGReWVVTUlNWWmBnb3iBiZKaoaerrq+vrKijnJSMg3lxaGFaVVJQUFJVWmFocXqEjZaepaqusbGwramim5KJgHZtZF1WUk9OTlFVW2JqdH2HkZqiqK6xs7OxraihmZCGfHJpYFlTT0xMTVFWXGRtd4GLlZ6mrLG0tbSxraafloyCeG5kXFVQTEtLTVFXX2dxe4aQmaKqr7S2trSwq6Sbkoh9c2lgWFJNSkpLTlNaYmx2gIuVnqatsrW3trOuqKCXjYN4bmRcVE9LSUlMUFZeZ3B7hZCao6qwtLe3tbGspJySiH1yaF9XUUxKSUpOU1pibHaBi5Wfp66ztre2s66nn5aMgndtY1tUT0tKSk1RV19ocnyHkZujqrC0tra0sKqimpCGe3FnX1dRTUtKTFBVXGVueIONl5+nrbK0tbSwq6Wck4l/dWtiW1RQTUxNUFRbYmt1f4mTnKSqr7K0s7Cspp6WjIN5b2ZeV1JPTU5QVFphaXJ8ho+YoKessLGxr6ymn5ePhXxyamJbVVJQUFFVWmBocHqDjJWdpKmtr6+uq6agmJCHfnVtZV5ZVVJSU1ZaYGdveIGJkpqgpqqsrayppaCZkYmAeG9oYVxYVVRVWFxhZ293f4ePl52jp6mqqaekn5iRioJ6cmtkX1tZV1haXWJob3Z+hY2Ump+jpqenpaKdmJGKg3t0bWdiXlxbW11gZGlvdn2Ei5KXnKCipKSin5uWkIqDfHZwamViX15eYGJma3B2fYOKj5WZnZ+goJ+cmZSPiYN9d3JsaGVjYWFjZWhtcXd9goiOkpaanJ2dnJqWko6Jg354c29raGZlZWZoa29zeH2Ch4yQlJeYmZmYlpSQjIiDfnl1cW5raWhoaWtucXV5fYKGio6RlJWWlpWTkY6KhoJ+enZzcG5sbGxtbnBzd3p+goaJjI+RkpOTkpCOjImFgn57eHVycW9vb3Bxc3Z4e3+ChYiKjI6PkI+PjYyJh4SBfnt5d3VzcnJyc3R2eHp9f4KEh4mKi4yNjIyLiYeFg4F+fHp4d3Z1dXV2d3h6fH6AgoSFh4iJioqKiYiHhYSCgH59e3p5eHh3eHh5ent9foCCg4SFhoeHh4eHhoWEgoGAf318e3t6enp6e3t8fX5/gIGCg4SFhYWFhYSEg4KCgYB/fn19fHx8fHx8fX1+f4CAgYKCg4ODg4ODg4KCgYGAgH9/fn5+fX19fn5+f39/gICBgYGCgoKCgoKBgYGBgICAf39/f39/f39/f39/gICAgICBgYGBgYGBgYGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=', 'data:audio/wav;base64,UklGRqQMAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YYAMAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf39/gICAgICAgICBgYGBgYGBgYGAgICAf39/f39/f39/f3+AgICBgYGCgoKCgoGBgYCAf39/fn5+fn5+fn5/gICBgYKCg4ODg4OCgoGBgH9+fn19fHx8fX1+fn+AgYKDg4SEhYSEhIOCgYB/fn18e3t7e3t8fH1/gIGChIWFhoaGhoWEg4KAf318e3p5eXl5ent8foCBg4WGh4iIiIiHhoSCgH58e3l4d3d3d3h5e31/goSGiImKi4uKiYeFg4F+fHl3dnV0dHV2eHp9f4KFh4qLjY2NjIuJh4SBfnt4dXRycnJydHZ5fH+DhomMjo+QkI+Ni4iFgX16dnNxcG9vcHJ0eHt/g4eLjpCSk5KRj42JhYF9eHRxb21sbG1wc3Z7f4SIjZCTlZaVlJGOioaBfHdyb2xqaWlrbXF1eoCFio+TlpiZmJaUkIuGgHp1cGxpZ2ZnaGtwdXqAhoyRlZmbnJuZlZGMhn95c25pZmRjZGZqbnR6gYiOlJicnp+em5eSjIV+d3FrZmJgYGFkaG50e4OKkZecn6GhoJ2Yk4yEfXVuaGNfXV1fYmdtdHyEjJSan6KkpKKfmZOLg3tya2RfXFpbXWFnbXV+h4+XnaKmp6ekoJqSioF4b2hhXFlYWFtgZm53gImSmqGmqaqppaCZkYh/dWxkXVlWVVZaYGdweYONlp6kqaysqqagmI+Ge3FoYFpVU1NVWmBocnyGkJqiqKyurqumn5eNgnhuZFxWUlBRVFphanV/ipWepqyvsa+spp6Uin90aWBYU09PUFRbY214g4+ZoqqvsrKwq6SbkYZ6b2VcVFBNTVBVXWZxfIiTnqetsrSzsKqimI2BdWpgV1FNS01RV2BqdYGNmKKrsbS1s6+on5SIfHBlW1NOS0tNUlpjbnqHk56nrrS2tbKspJqPg3ZrYFdQS0pLT1VeaHSAjZijq7K2t7WwqaCViX1wZVtTTUpJTFFZYm56hpOeqK+0t7azraWbj4N2al9WT0tJSk5VXWh0gI2Zo6yytre1sKmglYl8cGRaUk1KSUxSWWNve4eTn6ivtLe2sqykmo6CdWlfVk9LSktPVl9qdoKOmqSssrW2tK+nnpOHem5jWlJNS0tOVFxmcX2JlZ+or7O1tLCpoZeLf3NoXlZQTExOUlljbXmFkJukrLGzs7Cro5qPg3hsYllTT01OUlhganWBjJegqK6xsrCspZySh3xwZl1WUU9PUldeZ3J9iJOdpauvsK+spp6Vin90amFaVFFRU1ddZm96hY+Zoaisrq6rpp+WjYJ4bmVdV1RTVFddZW53goyVnqSprKyqpp+YjoV7cWhgW1dVVlldZGx2f4mSmqGmqaqopZ+YkIZ9dGtkXlpYWFpeZGx0fYaPl56jpqemo56YkIh/dm5nYV1bWlxgZWx0fISNlJugo6SkoZ2XkYmBeHFqZGBeXV5hZmxze4OLkpidoKGhn5yWkImCenNsZ2NhYGFjaG1zeoKJj5WanZ+enZqVkImCe3VvamZkY2NmaW50eoGHjZOXmpycmpiUj4mDfHZxbGlnZmZoa291eoCGi5CUl5mZmJWSjYiDfXhzb2xpaWlrbXF2e4CFio6SlJaWlZOQjIiDfnl1cW5sa2xtcHN3e4CEiIyPkpOTkpGOi4eDfnp2c3Fvbm9wcnV4fICEh4uNj5CQkI6MiYaCfnt4dXNxcXFydHZ5fICDhomLjY6OjYyKiIWCf3x5d3V0c3R1dnh6fYCDhYeJi4uLi4qIhoSBf3x6eHd2dnZ3eHp8foCChIaIiYmJiYiGhYOBf317enl4eHh5ent9foCChIWGh4eHh4aFg4KAf358e3p6enp7e3x+f4CCg4SFhYWFhYSDgoGAf359fHx8fHx8fX5+f4CBgoODhISEg4OCgoGAf39+fn19fX1+fn5/gICBgYKCgoKCgoKBgYCAf39/fn5+fn5/f3+AgICBgYGBgYGBgYGBgICAgH9/f39/f39/f4CAgICAgIGBgYGBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH9/f39/f39/f39/gICAgICBgYGBgYGBgYGBgYGBgICAgH9/f39+fn5+fn5+fn9/f4CAgYGBgoKCg4ODg4OCgoKBgYCAf35+fX19fHx8fH19fX5/f4CBgoKDhISEhYWFhISEg4KBgYB/fn18e3t6enp6e3t8fX5/gIGCg4SFhoaHh4eHhoaFhIOBgH99fHt6eXh4eHh4eXp7fH5/gYKEhYeIiYmKiomJiIeGhIKAf317eXh3dnV1dXV2d3l6fH6AgoWHiIqLjI2NjYyLiYiGg4F/fHp4dnRzcnJycnN0dnh7fYCDhYiKjI6PkJCQj46MioiFgn98eXZ0cnBvbm5vcHFzdnl8f4OGiYyPkZKTlJSTkY+NioeDf3x4dXJvbWtramtsbnBzd3t+g4aKjpGUlpeXl5aVkpCMiISAe3dzb2xqaGdnZ2lrbXF1eX6Ch4yQk5aZmpubmpiWko6KhYB7dnFtamdlY2NjZWdrbnN4fYOIjZKWmpyen5+enJmVkIuGgHp1cGtnY2FgX2BhZGhscXd9g4mPlJmdoKKjoqGfnJeSjYaAenNuaGRgXVxbXF5hZWpwdn2DipCWm6CjpaampKKemZSNh4B5cmtmYV1aWFhZW19jaW92fYSMk5meo6apqqmnpKCblY6Gf3dwaWNeWldVVVZZXWJob3Z+ho2VnKGmqqytrKqnopyVjoZ+dW5mYFtWU1JSVFdbYWdvd3+IkJeepKmtr6+urKijnJWNhHxza2NdV1NQT1BSVVpgZ294gYqSmqKorLCysrCtqaOclIuCeXBoYFpUUE5NTlBUWmFocXqDjZWdpauvsrSzsq6popuSiYB3bWVdV1FOTEtNUFVbYmpzfYaQmaGorrK0tbWyrqihmZCHfXNqYlpUT0xKSkxQVVxkbXaAipOcpKuwtLa2tbKtpp+WjYN5cGZeV1FNSklKTVFXX2dweoSOl6CnrrK1t7a0sKuknJOJf3VsY1tUT0tJSUtOU1pia3R+iJKbo6qwtLa3trOuqKCYjoV7cWhfWFJNSklKTVFXXmZveYONlp+mrbK1tra0sKuknJOKgHZsZFxVUExKSkxPVFtia3R+iJGaoqmvs7W1tLGtp5+XjoR7cWhgWVNPTEtMT1NYX2dweoONlp6lq7CztLSxrqiimpGIf3VtZF1XUk9NTU9SV15lbXZ/iZGaoaessLKysa6po5yUi4J5cWhhWlVST09QU1ddY2tzfIWOlp2kqa2vsK+tqaSdlo6FfXRsZV5ZVVJRUlRYXWNqcXqCipKZoKWprK2tq6ijnZePh393b2hiXVlWVFVWWV1jaXB4gIePlpyipqmqqqmmop2XkImBenJsZWBcWVhXWVtfZGlwd36FjJOZnqKlp6empKCclpCKg3x1b2lkYF1bW1xeYWVqcHZ9g4qQlpqeoaOko6GempWQioR9d3FsZ2NhX15fYGNna3B2fIKIjpOXm56foJ+em5iUj4qEfnlzb2pnZGNiYmRmaW1yd3yBh4yQlJeanJycm5mWko6JhH96dXFtamhmZmZnaWxvc3d8gYWKjpGUl5iZmJeVk5CMiIR/e3dzcG1ramlpamxucXV4fICEiIyPkZOUlZWUkpCOioeDgHx4dXJwbm1tbW5vcXR3en2AhIeKjI6QkZGRkY+Ni4mGg4B9end1c3JxcHBxcnR2eHt+gIOGiIqMjY6Ojo2Mi4mHhIKAfXt5d3V0dHN0dHV3eHp8foGDhYaIiYqLi4uKiYiHhYOBf358enl4d3Z2d3d4eXp8fX+BgoSFhoeIiIiIiIeGhYSCgX9+fXx7enl5eXl6ent8fX5/gYKDhIWFhoaGhoWFhIOCgYB/fn59fHx7e3t7fHx9fX5/gIGBgoODg4SEhISDg4KCgYGAf39+fn59fX19fX1+fn9/f4CAgYGCgoKCgoKCgoKBgYGAgIB/f39/f35+f39/f39/gICAgICBgYGBgYGBgYGBgYCAgICAgICAf39/f3+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==', 'data:audio/wav;base64,UklGRuQSAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YcASAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH9/f39/f39/f39/gICAgICBgYGBgYGBgYGBgYGBgYCAgH9/f39+fn5+fn5+fn5/f3+AgIGBgoKCg4ODg4ODgoKCgYGAgH9+fn19fXx8fHx9fX1+fn+AgYGCg4OEhIWFhYWEhIODgoGAf359fXx7e3p6enp7e3x9fn+AgYKDhIWGh4eHh4eHhoWEg4GAf318e3p5eHh3d3h4eXp7fX6AgoOFhoeIiYqKioqJiIeFhIKAfnx6eXd2dXV0dXV2d3h6fH6AgoWHiIqLjI2NjYyLioiGhIJ/fXt4dnRzcnFxcXJzdXd5e36BhIaJi42PkJCRkI+OjIqIhYJ/fHl2c3Fwbm5ubm9xc3V4e3+ChYmMjpGSlJSUlJKRjouIhYF9enZzcG5sampqa2xucXR4e3+EiIuPkpSWmJiYl5WTkIyIhIB7d3NvbGpoZmZmaGpscHN4fIGGio+TlpmbnJybmpiVkY2Ig355dHBraGVjYmJjZWdrb3N4foOJjpKXmp2foKCfnJqWkYyHgXt2cGtnZGFfXl9gYmZqb3R6gIaMkpebn6GjpKOhnpuWkYuFfnhybGdiX1xbW1xeYWVqcHZ9g4qQlpygo6anp6ajoJuWj4mCe3RtZ2JeWlhXWFlcYGVrcnmAh4+Vm6GlqKqqqqikoJqUjYV+dm9oYl1ZVlRUVVhcYWdtdX2FjJSboaaqrK2tq6ikn5iRiYF5cWliXFhUUlFSVFhcYmlxeYKKkpqgpquusLCvrKijnJWNhHxza2NdV1NQT09RVFlfZm12f4iQmKCmq6+ys7KvrKagmJCHfnVtZF1XUk9NTU5RVVtianN8hY6Xn6assLO0tLKuqaOck4qBd25mXldSTkxLTE5TWF9ncHmDjJWepauwtLa2tLGspp6WjYN5cGdfWFJOS0pKTVFWXWVud4GKlJykq7C0tre1sq6noJiPhXtyaGBZUk5LSUpMT1VbY2x1f4mSm6OqsLS2t7azr6mhmZCGfXNqYVlTTktJSUtPVFpia3R+iJGaoqmvs7a3trOvqaKakYd+dGtiWlRPS0pKS09UWmJqc32HkJmhqK6ztba1s6+popqRiH51bGNbVVBMS0tMT1RaYmpzfYaQmKCnrbG0tbSyrqiimpGIf3VsZFxWUU5MTE5RVVtja3R9ho+YoKassLKzs7Csp6CZkId+dW1lXVdTUE5OT1NXXWRsdX2Gj5efpaqusLGwrqqln5ePh351bWVfWVVSUFBSVVpfZm52foePl56kqayur66rp6KclY2FfXVtZmBbV1RTU1VYXGJocHd/h4+WnaKnqqusq6ikn5mTi4R8dG1nYVxZV1ZWWFtgZWtyeYGIj5acoaSnqKinpaGclpCJgnt0bWhiXltaWVpcX2NobnV7gomPlZufoqSlpaOhnZmTjYeAenRuaGRhXl1dXmBjZ2xxd32Eio+VmZ2foaKhn52ZlZCKhX95c25qZmNhYGBiZGdrb3R6f4WKj5SXmp2enp2bmZWRjYiCfXhzb2toZmRkZGZoa29zd3yBhouPk5aYmZqamZeVkY6JhYB8d3NwbWppaGhoamxvcnZ6foOHi46Rk5WWlpaVk5GOioeDf3t3dHFvbWxrbGxucHN2eX2AhIeKjY+RkpOTkpGPjYqHhIF+end1c3Fwb29vcHJ0dnl8f4GEh4mMjY6Pj4+OjYuJh4WCf316eHZ0c3NycnN0dXd5e36AgoWHiIqLjIyMjIuKiIaFg4B+fHt5eHd2dXV2dnd5enx9f4GDhIaHiImJiYmJiIeFhIOBf359e3p5eXh4eHl5ent8fn+AgoOEhYaGh4eHhoaFhIOCgYB/fn18e3t7e3t7e3x8fX5/gIGCgoOEhISEhISEhIOCgoGAgH9+fn19fX19fX19fn5/f4CAgYGCgoKDg4ODgoKCgYGBgIB/f39/fn5+fn5+fn9/f3+AgICBgYGBgYGBgYGBgYGBgICAgICAf39/f39/f39/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgYGBgYGAgICAgH9/f39/f39/gICAgIGBgYGBgYGBgYCAf39/fn5+fn5/f4CAgYGCgoKCgoKCgYGAf39+fn19fX1+fn+AgYGCg4ODg4ODgoGAf35+fXx8fHx9fX5/gIKDhISFhYWEg4KBgH59fHt7ent7fH1/gIKDhIWGhoaGhYSCgH59e3p5eXl5enx9f4GDhYeIiIiIh4WDgX99e3l4d3d3eHp8foGDhoiJioqKiYeFgn99enh2dXV1dnh7fYCDhomKjIyMi4mGg4B9end1c3NzdHZ5fH+DhomMjo6OjYuIhYF9enZzcXBwcnR3en6ChoqNj5GRkI6Lh4N+enZycG5ub3F0eH2ChouOkZOTkpCNiYR/enVxbmxrbG5ydnuBhouQk5WWlZOQi4aAenVwbGppamxvdHl/houRlZeYmJaSjYeBe3Rva2hmZ2ltcnh+hYyRlpmbm5mVkImCe3RuaWZkZGZqb3Z9hYySmJudnZuXkouEfHRtaGRhYWNnbXR8hIyTmZ2goJ6alI2FfHRsZmJfX2Fla3J6g4yUm5+io6Gdl4+GfXRsZWBdXF5iaHB5g4yVnKGkpaOfmZGHfnRrY15aWltgZm94goyVnaOnqKahm5KIfnRqYlxYV1ldZG13goyWn6WpqqiknZSJfnNpYVpWVVdbY2x2go2XoKerrKqlnpWKfnNoX1hUU1VaYWt2go2Yoqmtrqynn5aKfnJnXldSUVNYYGp2go6ao6qvsK6ooJaKfnFmXFVQT1JXX2p2g4+bpaywsa+qoZaKfXBkW1NPTlBWX2p2g5Ccpq6ys7CqoZaKfG9jWVFNTU9WX2p3hZKeqK+ztLGroZaJe21hV1BMTE9VX2t4hpOgqrG1tbGroZWHeWxfVU5LS09WYGx6iJWiq7K2tbGqoJOGd2peVE1KSk9WYW57ipejrbS2trGpnpKDdWdcUkxJSk9XYnB+jJqlr7W3tbConY+Bc2VaUUtJS1BZZXKAj5ynsLW3ta+mmo1+cGNYT0pJTFJbZ3WDkZ6psba3tK2kl4p7bWBWTkpKTVReaniGlKGrsra2squhlIZ4al5UTUpLT1ZhbXuKl6Ots7a1sKidkYN1Z1xTTUtMUVlkcX+NmqWus7WzrqWajX9xZVpSTUxOVF1odYOQnaevs7Sxq6GWiXtuYlhRTU1QV2FseYeUn6mvsrKup52RhHdrX1dRTk9TW2VxfouXoqqvsbCro5mNgHNnXVZRUFJXX2p1go+apKuvr62nn5SIfHBlXFVSUlVbZG56hpKdpautramjmo+DeGxiW1ZTVFlfaXN/ipWfpqqsqqWelYp/dGlhWlZWWF1kbXiDjpigpqmpp6GZkIV7cGdfWlhYW2Fpc32HkZqhpaemo5yUi4F3bWVfW1pbYGZueIGLlJyhpKWjnpiPhnxza2RfXV1fZGtzfIaOlpyhoqKfmpOKgnlwaWNgX2BjaXB4gYmRmJyfoJ6alY6GfXVuaGRiYmRobnV8hYyTmJydnZqWkImBenNsaGVkZWhscnmBiI6UmJqbmZaRi4V+d3FsaGdnaGxxd32EipCUl5iYlpKNh4F6dXBsamlqbHB1e4GHjJGUlpaUko6Jg354c29ta2xtcHR5f4SJjZGTk5ORjoqFgHt2c3Bubm9xdHh9gYaKjZCRkZCNioaCfXl2c3FwcXJ1eHyAhIeLjY6PjoyKh4N/e3h1c3Jyc3V4e36ChYiKjI2Mi4mHhIB9enh2dXR1dnh7foGDhoiKioqKiIaEgX98enh3dnd4eXt9gIKEhoiIiYiHhoSCgH18enl4eHl6e31/gYOEhoeHh4aFhIKAfn18e3p6ent8fX+AgoOEhYWFhYSDgoF/fn18fHt8fH1+f4CBgoOEhISEg4KCgYB/fn19fX19fn5/gIGBgoKDg4OCgoGBgH9/fn5+fn5+f3+AgIGBgYKCgoKBgYCAgH9/f39/f39/f4CAgIGBgYGBgYGBgICAgIB/f39/f4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH9/f39/gICAgICAgIGBgYGBgYGBgYGAgICAf39/f39/f39/f3+AgICBgYGCgoKCgoKCgYGBgIB/f35+fn19fX5+fn9/gIGBgoKDg4ODg4ODgoGBgH9+fn18fHx8fHx9fn9/gIGCg4SEhYWFhYSDg4KAf359fHt7enp6e3t8fX6AgYKEhYaGh4eHhoWEg4KAfn17enl4eHh4eXp7fX+AgoSGh4iJiYmJiIeFg4F/fXt5eHd2dnZ2d3l7fX+ChIaIiouMjIuLiYeFg4B+e3l3dXRzc3N1dnh7fYCDhomLjY6Ojo6MioiFgn98eXZzcnFwcHFzdXh7f4KGiYyOkJGRkZCOi4iEgH15dXJwbm1tbnBydXl8gYWJjJCSlJSUk5GOi4eDfnp1cm5sa2prbG5ydXp/hIiNkZSWl5eXlZKOioWAe3ZxbWpoZ2doa25yd3yCh4yRlZiam5qZlpKNiIJ8d3FsaWZkZGVnam90eoCGjJGWmpyenpyalpGLhX54cmxnZGJhYWNma3B3fYSLkZebn6GhoJ2ZlI6IgHlybGZiX15eX2NnbXN7goqRl5ygo6SjoZ2YkoqDe3NsZmFdW1tcX2NpcHiAiJCXnaKlp6eloZyVjYV9dGxlYFtYWFlbYGZtdX6Hj5eeo6epqqikn5iQiH92bWVfWlZVVlhdY2pzfIWOl56lqaysq6eim5OKgHduZV5YVFNTVVlgZ3B6hI2Xn6arrq+uqqWeloyCeG5lXVdTUFBTV11lbniCjJafpqyvsbCtqKGYjoR5b2VdVlFPTlBUW2JsdoGMlp+nrbGzsq+qo5qQhXpvZV1VUE1NTlJZYWp1gIuWn6eusrS0sayknJGGe3BlXFVPTEtNUVdfaXR/ipWfqK+ztbWyraadkod8cGVcVE9LSkxQVl5oc36KlaCor7S2trOup52Th3xwZVxUTkpJS09VXmhzfoqWoKmwtLe2tK6nnpOHfHBlW1NOSklLT1VeaHN/ipagqbC1t7a0rqedk4d7b2VbU01KSUtPVl5oc3+LlqGpsLW3trOupp2ShnpvZFtTTUpJS1BWX2l0gIyXoaqwtLa1sq2lm5GFeW5jWlNOS0pMUVhha3aBjZiiqrC0tbSxq6Oaj4R4bWNaU05MS05TWmJteIOOmaKqsLO0s6+poZeNgndsYlpTT01NUFVcZW96hZCao6qvsrOxraaelYuAdWthWlRQTk9SWF9ocXyHkZujqq6wsa6qpJuSiH1zaWFaVFFQUlVbYmt0f4mTm6Opra+urKegmI+Fe3FoYFpVU1NUWF5lbneBi5Sco6irrKuoo52VjIJ5cGdgW1dVVVhcYmlxeoSNlZ2jp6mqqKWgmZGJgHduZ2BcWVhYW2BmbXV9ho+WnaKlp6eloZyVjYV9dW1mYV1bWlxfZGpxeICIkJecoaOko6GdmJGKgnpzbGZiX11eX2NobnR8g4qRl5yfoaGgnZmTjYZ/eHJsZ2NhYGFjZ2xyeH+GjJKXm52enpyZlY+Jg312cWxoZWRjZWdrcHV7goiNkpaZm5uamJWQi4aAenVwbGlnZmdpbG90eX6EiY6SlZeYmJaUkY2Ig355dHBta2pqa21vc3d8gYaKjpGTlZWUk5CNiYWAfHh0cW5tbG1ucHN3e3+Dh4qNkJGSkpGPjImGgn57d3RycG9vcHJ0d3p9gYSHio2Oj4+PjYyJhoOAfXp3dXNycnJ0dXd6fX+ChYiKi4yNjIyKiIaEgX58enh2dXV1dXd4enx/gYOFh4mKioqKiYeGhIKAfnx6eXh3d3d4eXt8foCChIWGh4iIiIeGhYOCgH99fHt6eXl5ent8fX6AgYKDhIWGhoaFhYSDgoF/fn18fHt7e3t8fX1+f4CBgoODhISEhIODgoGBgH9+fn19fX19fX5+f3+AgYGCgoKDg4OCgoKBgYCAf39+fn5+fn5+f3+AgICBgYGBgYGBgYGBgYCAgIB/f39/f39/f3+AgICAgICBgYGBgYGBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=', 'data:audio/wav;base64,UklGRuQSAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YcASAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH9/f39/f3+AgICAgICBgYGBgYGBgYGBgYCAgIB/f39/f35+fn9/f3+AgICBgYGCgoKCgoKCgoGBgYCAf39+fn19fX19fn5+f4CAgYKCg4ODhISEg4OCgoGAf39+fXx8fHt7fHx8fX5/gIGCg4SFhYWGhoWFhIOCgYB+fXx7enp5eXp6e3x9fn+BgoSFhoeHiIiHh4aFg4KAfn17enl4d3d3eHl6e31/gYOFhoiJioqKiomIhoWDgX58enh3dnV0dXV2eHl8foCDhYeJi4yNjY2MiomGhIF/fHl3dXNycnJyc3V3en2Ag4aJi42PkJCQj42LiIWCf3t4dXNxb29vb3FzdXh8f4OHio2PkZOTk5KQjoqHg397d3Rxbmxra2xtcHN2en6Dh4uPkpSWlpaVk5CNiYSAe3Zyb2xpaGhpam1wdHl+g4iMkZSXmZqZmJaTj4qFgHt1cWxpZmVlZWdqbnJ4fYOIjpOXmpydnZuZlZGMhoB6dG9qZmNiYWJkZ2xxdn2DiY+VmZ2foKCfnJiTjYeAeXNtaGNgXl5fYWVpb3V8g4qRl5ygoqSjop+alY6HgHlya2VhXVtbXF5iaG51fISMk5mfo6WnpqShnJaPh4B4cGljXlpYWFlcYGZtdX2FjZWcoaapqqmno56Xj4d/dm5mYFtXVVVXWl9lbHV9ho+XnqSpq6ysqaWfmI+HfXRsZF1YVFJTVFheZGx1f4iRmqGnrK6vrqumn5iPhXxyaWFaVVJQUFNXXWVtd4CKlJykqq6xsa+spp+XjoR6cGZeV1JPTk9SV11lbniDjZefp62xs7OxrKafloyBd21jW1VQTUxOUVdeZ3B7hZCaoqqvs7W0saylnZSJf3RqYFhSTUtLTVFXX2lzfomTnaWtsrW2tLGrpJuRhntwZl1VT0xKSk1SWWJrdoGMl6Cpr7S2trSwqqKYjoN3bWNaU01KSUtOVFtkb3qFkJqkq7G1t7azrqeflYp/c2lfV1BMSUlLUFZfaHN+iZSep66ztre1sqykm5CFem9lXFROS0lKTVNaY213g46YoqqwtLa2tK+ooJaMgXVrYVlSTUpKTFBWXmdxfIiSnKWssrW2tLGrpJuRhntxZ11WUExLS05TWmNsd4KMl6CorrK0tLKup5+WjIF2bGNaVE9NTE5SWF9ocnyHkZujqq+ys7KuqaKakIZ7cWhfWFNPTk9RVl1lbniCjJaepquvsbGuqqSclIqAdm1kXFZSUFBSVltja3R+iJGaoaisrq+uqqWelo2EenFoYVtWU1JTVlthaXF6hI2VnaOoq62sqaWfmJCHfnVtZV9aVlVVV1thZ294gImRmZ+kqKqqqKSfmZKKgXlwaWNdWlhYWVxhZ251foaOlZuhpKenpqOfmZOLhHx0bWZhXVtaW15iZ210fIOLkpidoaOko6GemZOMhX53cGplYV9eXmBjaG1zeoGIjpSZnaChoZ+cmJONhoB5c21oZWJhYWJlaW5zeX+GjJGWmpydnZyalpKNh4F7dXBsaGZkZGVna29zeX6EiY6TlpmampmXlZGMh4J9eHNva2loZ2hqbHB0eX6DiIyQk5WXl5aVko+Lh4J+eXVxbmxramtsb3J1eX2ChoqNkJKUlJSSkI2KhoN/e3d0cW9ubm5vcXN2en2BhYiLjY+QkZGQjoyJhoJ/fHl2dHJxcXFyc3V4e36BhIeJi42Ojo6NjIqHhYJ/fXp4dnV0c3R0dnd5fH6Ag4WHiYqLi4uKiYiGhIKAfXt6eHd2dnZ3eHl7fH6AgoSGh4iJiYmIh4aFg4GAfnx7enl5eHl5ent8fX+AgoOEhYaGh4aGhYSDgoGAfn18fHt7ent7fHx9fn+AgYKDhISEhYSEhIOCgYGAf359fX18fHx9fX5+f4CAgYKCgoODg4ODgoKBgYCAf39+fn5+fn5+fn9/f4CAgYGBgYKCgoKBgYGBgICAgH9/f39/f39/f3+AgICAgICBgYGBgYGBgYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBgYGBgYGAgICAgH9/f39/f39/f4CAgICBgYGBgoKCgYGBgICAf39+fn5+fn5+f3+AgIGBgoKDg4ODgoKBgYB/fn59fX19fX1+fn+AgYKCg4SEhISEg4KCgX9+fX18e3t7e3x9fn+AgYOEhYWGhoaFhIOCgH99fHt6enl5ent8fX+BgoSFhoeIiIeGhYSCgH58enl4d3d4eXp7fX+ChIaHiYmKiomIhoSCf316eHd2dXV2d3l7fYCDhYiKi4yMjIqJhoSBfnt4dnRzc3N0dnh7foGFiIqMjo6OjYyJh4OAfHl2c3FwcHFzdXh7f4OHio2PkZGRj42KhoJ+enZzcG5ubm9xdHh8gYWKjZCSlJSTkY6KhYB8d3NvbWtrbG5xdHl+g4iNkZSWl5aUkY6JhH55dG9saWhoam1wdXuAhoyRlZiZmZiWko2HgXt1cGtoZmVmaGxxd32EipCVmZucnJqWkYuFfndxa2dkYmNkaG1zeYCIjpSZnZ+fnZqWkImBenNsZ2NgX2FkaG51fYWMk5meoaKhnpqUjYV9dW1nYl5dXWBkanF5gYqSmZ6ipKSinpmRiYF4b2hiXVtaXGBlbHV+h5CYnqOmp6ajnZaOhHtyaWJcWVdYW2FocHqDjZaepKiqqaahmpKIfnRrY1xYVVVYXWNsdYCKlJ2kqaysqqWflo2CeG1kXVdUU1VZX2hxfIeRm6Opra6tqaObkYZ7cGZdV1JRUlVbY214hI+ZoqmusLCsp56Vin5zaF5XUk9PUlhgaXSAjJehqa+ysq+qopiNgXVqYFdRTk1QVVxmcX2JlZ+or7O0sq2lnJGFeGxhWFFNTE1SWWJueoaTnqeus7Wzr6iflIh7b2NZUk1LTFBWYGt3hJCcpq6ztrWxq6KXi35xZVtSTUpKTlRdaHSBjpqlrbO2trOtpJmNgHNnXFNNSkpNUltmcn+MmKOss7a3tK6mm4+CdWldVE5KSUxRWWRwfYqXoquytre1r6edkYR3al9VTkpJS1BYYm57iJWhqrG2t7WwqJ6ShXhsYFZPS0lLUFhibXqHlJ+psLW2tbCpn5OHeW1hWFBMSktQV2FteYaTnqivtLa0sKmflId6bmJZUU1LTFFYYWx5hZKdp66ztbOvqJ+UiHtvY1pTTkxNUVhhbHiFkZymrbKzsq6nnpSIe29kW1RPTU9TWWJteIWQm6SssLKxraadk4d7cGVcVVFPUFRbY255hZCbo6qusK+rpZySh3twZl1XUlFSVlxlb3qFkJqiqa2uramjmpGGe3BmXlhUU1RYXmdwe4WQmaGnq6yrp6CYj4V6cGdfWlZVV1thaXJ8hpCZoKapqqiknpaNg3pwaGBbWFhZXWNrdH2HkJifpKenpaGblIuCeXBoYl1bWlxgZm12f4iQmJ6ipKSinpmRiYF4cGljX11dX2NpcHiAiJCXnKCiop+blo+Hf3dwaWRhYGBiZmxyeoGJkJabnp+fnJiTjIV+d3BqZmNiY2Vpb3V8g4qQlZmcnJyZlZCKg312cGtoZmVmaWxxd36EipCUl5mamJaSjYiCe3ZxbWpoaGlscHR6f4WKj5OVl5eVk4+KhYB7dnFubGtrbG9yd3yBhoqOkZOUlJKQjIiDf3p2cm9ubW5vcnV5foKGio2QkZGRj42JhoJ+enZzcXBwcXJ1eHt/g4aKjI6Pj46MioeEgH16d3VzcnJzdXd6fYCEhomLjI2Mi4qIhYJ/fHp4dnV1dXZ4enx/gYSGiImKioqJh4WDgX58enl3d3d3eHp8foCChIaHiIiIiIeFhIKAfnx7enl5eXl6fH1/gIKEhYaGhoaGhYSCgX9+fXx7e3p7e3x9foCBgoOEhIWFhISDgoGAf359fXx8fHx9fn5/gIGCgoODg4ODgoKBgIB/fn5+fX19fn5/f4CAgYGCgoKCgoKBgYGAgH9/f35+fn9/f3+AgICBgYGBgYGBgYGAgICAf39/f39/f3+AgICAgICAgYGBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgYGBgYCAgICAgH9/f39/f3+AgICAgYGBgYGBgYGBgICAf39/fn5+f39/gICBgYKCgoKCgoGBgIB/f35+fX19fn5/gICBgoKDg4ODg4KBgIB/fn18fHx8fX5+gIGCg4SEhYWEhIOCgH9+fXx7e3t7fH1+gIGDhIWGhoaGhYOCgH99e3p5eXl6e3x+gIKEhYeHiIiHhoSCgH58enh4d3h4enx+gIOFh4iJiomIh4WCf316eHZ2dXZ3eXt+gYSHiYuMjIuKh4WCfnt4dnRzc3R2eHt/goaJi42Ojo2LiIWBfXl2dHJxcXJ1eHt/hIiLjo+QkI6MiISAe3d0cW9vb3F0eHyBhoqOkJKTkpCMiIN+eXVxbm1sbXBzeH2DiI2Rk5WVk5GNiIJ8d3Jua2pqbG90eX+Fi5CUlpiXlZGMhoB6dG9raGdoa290eoGIjpOXmZqZlpGLhX53cGtnZWVmam91fISLkpebnJyalpGKgnpzbGdkYmNlanB3f4ePlpuen56blo+Hf3dvaGNgYGFla3J6g4uTmp+hop+blY2Ee3JqZF9dXmBlbHR+h5CYnqKko6Cak4qAd21mYFxbXGBmb3iCjJWdo6ampKCZkIZ8cWhhW1lZXGFpcnyHkZqip6mopJ6WjIF2bGNcWFZYXGNsd4KNl6Cmqqupo5ySh3twZl1XVFRYXmZwfIiTnaWrrayooZiNgXVqYFhUUlRZYGp2go+ao6qur6ymnpOHem5jWlRRUVRbZXB9iZagqa6xr6ujmY2Ac2dcVVBPUVdfaneEkZ2nrrKyrqiek4V4a2BWUE1OU1plcX6MmaSssrOyrKOYi31wY1lRTUxPVl9reYeUoaqxtLSwqJ2Rg3VnXFNNS01SW2Z0gpCdqLC0tbKsopaIemxfVU5KS09XYW59i5mlrrS2ta+mm41/cGNYT0tKTVNdaniGlKGss7a2sqqfkoN1Z1tRS0lLUFllc4KQnqmxtre0raOWiHlrXlRNSUpOVmFvfYyapq+1t7WvppqMfW9iV05KSU1UXmt5iJajrbS3trGpnZCBc2VZUUtJTFJbZ3WEkp+qsra2squgk4V3aVxTTUpLUVllcoCPnKewtbazrKKWiHpsYFVOS0tQWGJvfYyZpK2ztbOtpJmLfW9jWFBMTFBXYW16iJaiq7G0sq6lmo6AcmVbU05NUFZfa3iGk5+or7KyrqackIJ1aF1VUE5QVl5pdoOQnKatsLGtpp2RhHdrYFdSUFFWXmh1gY6apKuvr6ymnZKGeW1iWlRSU1deaHOAjJehqKytq6Wdk4d7b2VcVlRUWF9oc36KlZ+mqqyqpJ2TiHxxZ15ZVlZZYGhyfomTnaSoqaijnJOIfXJpYVtYWFthaXJ9iJKboaanpqKbkol+dGpjXVpaXWJpc3yHkJmfo6WkoJqSiX91bGVgXVxfZGtzfIaPl52ho6KemJGIf3ZuZ2JfX2FmbHR8hY6Vm5+gn5yXkIh/d29pZGJhY2dtdX2FjZSZnJ6dmpWOh393cGpmZGRmam92fYWMkpeam5qXk42Gf3hxbGhmZmhscXd+hYuRlZiZmJWRjIV/eHNuamlpa25zeH6Eio+TlpaVk4+KhH55dG9sa2ttcHR5f4SKjpGTlJORjYmDfnl1cW9tbm9ydnt/hImNkJGRkY6Lh4N+enZzcXBwcnR4fICEiIuOj4+OjImGgn56d3RycnJ0dnl9gYSHioyNjYyKiISBfnp4dnR0dHZ4e36BhIeJiouLioiGg4B+e3l3dnZ3eHp8f4GEhoiJiYmIhoWCgH57enh4eHh6e31/gYOFhoeHh4aFg4GAfnx7enl6ent8foCBg4SFhoaFhYSCgX9+fXx7e3t8fH5/gIGCg4SEhISDg4GAf359fXx8fH1+fn+AgYKDg4ODg4KCgYB/f35+fX1+fn5/gICBgYKCgoKCgYGAgH9/f35+fn9/f4CAgIGBgYGBgYGBgICAgH9/f39/f3+AgICAgIGBgYGBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=']
      const SOUND_KEY = 'naiwa-ism:sound'
      /* 两张原创矢量图分别用于静止和播放音效时的背景。 */
      const IDLE_DATA = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMjAgMjgwIj48ZyBzdHJva2U9IiM0MjM3MjAiIHN0cm9rZS13aWR0aD0iNCIgZmlsbD0iI2Y1YzUxOCI+PGVsbGlwc2UgY3g9IjExMCIgY3k9IjE5MCIgcng9IjcyIiByeT0iNzciLz48ZWxsaXBzZSBjeD0iMTEwIiBjeT0iMTEyIiByeD0iNzgiIHJ5PSI0NCIvPjxjaXJjbGUgY3g9Ijc4IiBjeT0iOTAiIHI9IjE3IiBmaWxsPSIjYmNkZjg0Ii8+PGNpcmNsZSBjeD0iMTQzIiBjeT0iOTAiIHI9IjE3IiBmaWxsPSIjYmNkZjg0Ii8+PC9nPjxnIGZpbGw9IiMzNDJkMjIiPjxjaXJjbGUgY3g9IjgwIiBjeT0iOTQiIHI9IjYiLz48Y2lyY2xlIGN4PSIxNDIiIGN5PSI5NCIgcj0iNiIvPjwvZz48cGF0aCBkPSJNNzMgMTIwcTQxIDEzIDc4LTIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzU0MmYyYSIgc3Ryb2tlLXdpZHRoPSI1IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48ZWxsaXBzZSBjeD0iMTEwIiBjeT0iMjA2IiByeD0iNDEiIHJ5PSI0NCIgZmlsbD0iI2ZmZTg5YSIvPjwvc3ZnPg=='
      const LAUGH_IMG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMjAgMjgwIj48ZyBzdHJva2U9IiM0MjM3MjAiIHN0cm9rZS13aWR0aD0iNCIgZmlsbD0iI2Y1YzUxOCI+PGVsbGlwc2UgY3g9IjExMCIgY3k9IjE5MCIgcng9IjcyIiByeT0iNzciLz48ZWxsaXBzZSBjeD0iMTEwIiBjeT0iMTEyIiByeD0iNzgiIHJ5PSI0NCIvPjxjaXJjbGUgY3g9Ijc4IiBjeT0iOTAiIHI9IjE3IiBmaWxsPSIjYmNkZjg0Ii8+PGNpcmNsZSBjeD0iMTQzIiBjeT0iOTAiIHI9IjE3IiBmaWxsPSIjYmNkZjg0Ii8+PC9nPjxwYXRoIGQ9Ik02NyA5N3ExMy0xNyAyNCAwbTM4IDBxMTMtMTcgMjQgMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMzQyZDIyIiBzdHJva2Utd2lkdGg9IjYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjxwYXRoIGQ9Ik03MiAxMjBxMzkgNTggNzgtMnEtMzYgMTEtNzggMiIgZmlsbD0iIzU0MmYyYSIvPjxlbGxpcHNlIGN4PSIxMTAiIGN5PSIyMDYiIHJ4PSI0MSIgcnk9IjQ0IiBmaWxsPSIjZmZlODlhIi8+PC9zdmc+'
      let backdropNode = null

      function backdropCss() {
        /* 真图浮在最上层做水印：不依赖面板半透明，保证一定看得见；pointer-events:none 不挡操作。 */
        return 'body::after{content:"";position:fixed;inset:0;z-index:2147483000;pointer-events:none;'
          + 'background-image:url("' + IDLE_DATA + '");background-repeat:no-repeat;'
          + 'background-position:right -10vh center;background-size:auto 52vh;opacity:.24;'
          + '-webkit-mask-image:linear-gradient(to bottom,black 70%,transparent 92%);'
          + 'mask-image:linear-gradient(to bottom,black 70%,transparent 92%)}'
          + 'body[data-ds-dark-theme]::after{opacity:.16;filter:brightness(1.15) saturate(1.1)}'
          + 'body.naiwa-laughing::after{background-image:url("' + LAUGH_IMG + '");background-size:auto 48vh;opacity:.30}'
      }

      function installBackdrop(doc) {
        if (backdropNode !== null) return backdropNode
        const target = doc === undefined ? globalThis.document : doc
        if (target === null || target === undefined || target.head === undefined
          || typeof target.createElement !== 'function') return null
        const node = target.createElement('style')
        if (typeof node.setAttribute === 'function') node.setAttribute('id', BACKDROP_ID)
        node.textContent = backdropCss()
        target.head.appendChild(node)
        backdropNode = node
        return node
      }

      function removeBackdrop() {
        if (backdropNode === null) return
        const node = backdropNode
        backdropNode = null
        try {
          if (node.parentNode !== null && node.parentNode !== undefined
            && typeof node.parentNode.removeChild === 'function') node.parentNode.removeChild(node)
        } catch (_error) {
          /* 移除失败不阻塞关闭皮肤。 */
        }
      }

      /* ---------------- 奶蛙音效 ---------------- */

      function readSound(storage) {
        try {
          const store = storage === undefined ? globalThis.localStorage : storage
          if (store === null || store === undefined || typeof store.getItem !== 'function') return 'on'
          return store.getItem(SOUND_KEY) === 'off' ? 'off' : 'on'
        } catch (_error) {
          return 'on'
        }
      }

      function writeSound(storage, value) {
        try {
          const store = storage === undefined ? globalThis.localStorage : storage
          if (store === null || store === undefined || typeof store.setItem !== 'function') return false
          store.setItem(SOUND_KEY, value)
          return true
        } catch (_error) {
          return false
        }
      }

      /** 随机变速 + 随机音量播一次；自动播放被拦截时静默失败。 */
      function playLaugh() {
        const AudioCtor = globalThis.Audio
        if (typeof AudioCtor !== 'function') return false
        try {
          const clip = LAUGH_CLIPS[Math.floor(Math.random() * LAUGH_CLIPS.length)]
          const audio = new AudioCtor(clip)
          const doc = globalThis.document
          const body = doc === undefined || doc === null ? undefined : doc.body
          let settled = false
          const backToIdle = function () {
            if (settled) return
            settled = true
            try {
              if (body !== undefined && body !== null && body.classList) body.classList.remove('naiwa-laughing')
            } catch (_error) { /* 无 body：忽略 */ }
          }
          try {
            if (body !== undefined && body !== null && body.classList) body.classList.add('naiwa-laughing')
          } catch (_error) { /* 无 body：忽略 */ }
          audio.onended = backToIdle
          audio.onerror = backToIdle
          audio.volume = 0.5 + Math.random() * 0.35
          audio.playbackRate = 0.9 + Math.random() * 0.22
          const played = audio.play()
          if (played !== undefined && played !== null && typeof played.catch === 'function') {
            played.catch(backToIdle)
          }
          return true
        } catch (_error) {
          return false
        }
      }

      /** 订阅本会话事件流：只在订阅之后追加的 turn/end(completed) 上回调一次。 */
      function watchTurnEnd(ctx, sessionId, onEnd) {
        try {
          if (typeof ctx.get !== 'function') return function () {}
          const sessions = ctx.get('sessions')
          if (sessions === null || sessions === undefined || typeof sessions.binding !== 'function') return function () {}
          const binding = sessions.binding(sessionId)
          if (binding === null || binding === undefined || binding.eventSource === undefined) return function () {}
          const source = binding.eventSource
          if (typeof source.subscribe !== 'function' || typeof source.getSnapshot !== 'function') return function () {}
          let lastSeq = 0
          try {
            const initial = source.getSnapshot()
            const entries = initial && initial.entries ? initial.entries : []
            for (const entry of entries) {
              const seq = entry && entry.event && typeof entry.event.seq === 'number' ? entry.event.seq : 0
              if (seq > lastSeq) lastSeq = seq
            }
          } catch (_error) {
            lastSeq = 0
          }
          return source.subscribe(function () {
            let snapshot
            try {
              snapshot = source.getSnapshot()
            } catch (_error) {
              return
            }
            const change = snapshot === undefined || snapshot === null ? undefined : snapshot.change
            if (change === undefined || change === null || change.kind !== 'append') return
            for (const entry of change.entries) {
              const event = entry === undefined || entry === null ? undefined : entry.event
              if (event === undefined || event === null || typeof event.seq !== 'number') continue
              if (event.seq <= lastSeq) continue
              lastSeq = event.seq
              if (event.type !== 'turn/end') continue
              const reason = event.data === undefined ? undefined : event.data.reason
              if (reason !== undefined && reason !== null && reason.kind === 'completed') onEnd()
            }
          })
        } catch (_error) {
          return function () {}
        }
      }

      function installLayer(state, theme) {
        if (state.layer !== null) return state.on === true
        if (theme === null || theme === undefined || typeof theme.overrideTokens !== 'function') return false
        let layer = null
        try {
          layer = theme.overrideTokens(SKIN_SOURCE, SKIN_PAIRS)
        } catch (_error) {
          layer = null
        }
        if (typeof layer !== 'function') {
          state.layer = null
          state.on = false
          skinBridge.on = false
          return false
        }
        state.layer = layer
        state.on = true
        skinBridge.on = true
        installBackdrop()
        return true
      }

      function removeLayer(state) {
        if (state.layer !== null) {
          try {
            state.layer()
          } catch (_error) {
            /* disposer 抛错不影响插件卸载。 */
          }
          state.layer = null
        }
        state.on = false
        skinBridge.on = false
        removeBackdrop()
      }

      /* 唯一开关状态机：true=安装并写 'on'（失败不写），false=移除并写 'off'。
       * 写盘异常只影响持久化，内存态照常切换、不抛。 */
      function setSkin(state, theme, on, storage) {
        if (on === true) {
          if (installLayer(state, theme)) writeStored(storage, 'on')
        } else {
          removeLayer(state)
          writeStored(storage, 'off')
        }
        skinBridge.publish()
        return state.on === true
      }

      /* ---------------- 样式（内联 + 主题 token，不 import CSS） ---------------- */

      function chipStyle(active, disabled) {
        return {
          appearance: 'none',
          display: 'inline-flex',
          flexShrink: 0,
          alignItems: 'center',
          border: '0.5px solid ' + (active ? 'var(--dsw-alias-border-selected)' : 'var(--dsw-alias-border-l2)'),
          background: active ? 'var(--dsw-alias-interactive-bg-active)' : 'transparent',
          color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
          borderRadius: 999,
          padding: '0 8px',
          height: 20,
          fontSize: 12,
          lineHeight: '18px',
          fontFamily: 'inherit',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }
      }

      function Chip(props) {
        return h('button', {
          type: 'button',
          disabled: props.disabled === true,
          'aria-pressed': props.active === true,
          title: props.title,
          onClick: props.onClick,
          style: chipStyle(props.active === true, props.disabled === true),
        }, props.label)
      }

      function NaiwaControl(props) {
        const t = props.t
        const send = props.send
        const bridge = props.skin

        const [view, setView] = React.useState(function () {
          const cached = readCache()
          return cached === null ? DEFAULT_VIEW : cached
        })
        const [status, setStatus] = React.useState(function () {
          const cached = readCache()
          return cached !== null && cached.lastText.length > 0
            ? { phase: 'cached', text: cached.lastText }
            : { phase: 'unknown', text: '' }
        })
        const [pending, setPending] = React.useState(false)
        const [skinOn, setSkinOn] = React.useState(function () {
          return bridge !== undefined && bridge !== null && bridge.on === true
        })
        const [skinReady, setSkinReady] = React.useState(function () {
          return bridge !== undefined && bridge !== null && bridge.available === true
        })
        const [open, setOpen] = React.useState(false)
        const [soundOn, setSoundOn] = React.useState(function () {
          return readSound() === 'on'
        })

        React.useEffect(function () {
          if (typeof props.watchEnd !== 'function') return undefined
          return props.watchEnd(function () {
            if (soundOn === true) playLaugh()
          })
        }, [soundOn, props.watchEnd])

        React.useEffect(function () {
          if (bridge === undefined || bridge === null || typeof bridge.subscribe !== 'function') return undefined
          function sync() {
            setSkinOn(bridge.on === true)
            setSkinReady(bridge.available === true)
          }
          sync()
          return bridge.subscribe(sync)
        }, [])

        function run(line, patch) {
          if (pending) return
          setPending(true)
          setStatus({ phase: 'pending', text: t('status.pending') })
          Promise.resolve(send(line)).then(function (outcome) {
            if (outcome.ok) {
              if (patch) {
                const next = {
                  strength: view.strength,
                  resident: view.resident,
                  language: view.language,
                  spell: view.spell,
                }
                Object.assign(next, patch)
                setView(next)
                writeCache(next, outcome.text)
              }
              setStatus({ phase: 'ok', text: outcome.text })
            } else {
              setStatus({ phase: 'failed', text: outcome.text })
            }
            setPending(false)
          }, function (error) {
            setStatus({ phase: 'failed', text: String(error) })
            setPending(false)
          })
        }

        const statusText = status.phase === 'unknown'
          ? t('status.unknown')
          : status.phase === 'pending'
            ? t('status.pending')
            : status.text
        const statusColor = status.phase === 'failed'
          ? 'var(--dsw-static-red-500)'
          : status.phase === 'pending' || status.phase === 'unknown'
            ? 'var(--dsw-alias-label-tertiary)'
            : 'var(--dsw-alias-label-secondary)'

        const sep = { color: 'var(--dsw-alias-label-tertiary)', padding: '0 2px' }
        const mark = {
          width: 8,
          height: 8,
          borderRadius: 999,
          background: '#F5C518',
          border: '1px solid #1A1A1A',
          display: 'inline-block',
          marginRight: 4,
        }
        /* 皮肤两态 chip：theme 就绪才出现；active 跟随叠层状态，不跟用户 light/dark 偏好。 */
        const skinChips = skinReady
          ? [
              h('span', { key: 'skin-sep', style: sep }, '·'),
              h(Chip, {
                key: 'skin-on',
                label: t('skin.on'),
                active: skinOn === true,
                disabled: false,
                title: t('title.skin'),
                onClick: function () {
                  if (skinOn !== true && bridge !== undefined && typeof bridge.toggle === 'function') bridge.toggle()
                },
              }),
              h(Chip, {
                key: 'skin-off',
                label: t('skin.off'),
                active: skinOn !== true,
                disabled: false,
                title: t('title.skin'),
                onClick: function () {
                  if (skinOn === true && bridge !== undefined && typeof bridge.toggle === 'function') bridge.toggle()
                },
              }),
            ]
          : []

        /* 收起态只占一个「奶蛙」小胶囊；展开是竖直面板，不挤占输入区。 */
        const wrap = { position: 'relative', display: 'inline-flex', alignItems: 'center', padding: '0 2px' }
        const toggle = {
          appearance: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          border: '0.5px solid var(--dsw-alias-border-l2)',
          background: open === true ? 'var(--dsw-alias-interactive-bg-active)' : 'transparent',
          color: 'var(--dsw-alias-label-primary)',
          borderRadius: 999,
          padding: '0 10px',
          height: 22,
          fontSize: 12,
          lineHeight: '20px',
          fontFamily: 'inherit',
          cursor: 'pointer',
        }
        const panel = {
          position: 'absolute',
          bottom: '100%',
          left: 0,
          marginBottom: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: 8,
          minWidth: 210,
          background: 'var(--dsw-alias-bg-layer-2)',
          border: '0.5px solid var(--dsw-alias-border-l2)',
          borderRadius: 10,
          boxShadow: '0 6px 20px rgba(0,0,0,.18)',
          zIndex: 20,
        }
        const rowStyle = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }
        const labelStyle = { minWidth: 30, color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, whiteSpace: 'nowrap' }
        const panelStatus = {
          fontSize: 11,
          color: statusColor,
          maxWidth: 240,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }

        const strengthRow = h('div', { key: 'strength', style: rowStyle },
          h('span', { style: labelStyle }, t('label.strength')),
          h(Chip, {
            key: 'off',
            label: t('strength.off'),
            active: view.strength === 'off',
            disabled: pending,
            title: t('title.strength'),
            onClick: function () { run('/naiwa strength off', { strength: 'off' }) },
          }),
          h(Chip, {
            key: 'naiwa',
            label: t('strength.naiwa'),
            active: view.strength !== 'off',
            disabled: pending,
            title: t('title.strength'),
            onClick: function () { run('/naiwa strength naiwa', { strength: 'naiwa' }) },
          }),
        )

        const languageRow = h('div', { key: 'language', style: rowStyle },
          h('span', { style: labelStyle }, t('label.language')),
          h(Chip, {
            key: 'auto',
            label: t('language.auto'),
            active: view.language === 'auto',
            disabled: pending,
            title: t('title.language'),
            onClick: function () { run('/naiwa language auto', { language: 'auto' }) },
          }),
          h(Chip, {
            key: 'zh',
            label: t('language.zh'),
            active: view.language === 'zh',
            disabled: pending,
            title: t('title.language'),
            onClick: function () { run('/naiwa language zh', { language: 'zh' }) },
          }),
          h(Chip, {
            key: 'en',
            label: t('language.en'),
            active: view.language === 'en',
            disabled: pending,
            title: t('title.language'),
            onClick: function () { run('/naiwa language en', { language: 'en' }) },
          }),
        )

        const skinRow = skinReady
          ? h('div', { key: 'skin', style: rowStyle },
              h('span', { style: labelStyle }, t('label.skin')),
              ...skinChips)
          : null

        const statusRow = h('div', { key: 'status', style: rowStyle },
          h(Chip, {
            key: 'sync',
            label: t('sync'),
            active: false,
            disabled: pending,
            title: t('title.sync'),
            onClick: function () { run('/naiwa status', null) },
          }),
          h('span', { style: panelStatus, title: statusText }, statusText),
        )

        const soundRow = h('div', { key: 'sound', style: rowStyle },
          h('span', { style: labelStyle }, t('label.sound')),
          h(Chip, {
            key: 'sound-on',
            label: t('sound.on'),
            active: soundOn === true,
            disabled: false,
            title: t('title.sound'),
            onClick: function () { setSoundOn(true); writeSound(undefined, 'on') },
          }),
          h(Chip, {
            key: 'sound-off',
            label: t('sound.off'),
            active: soundOn !== true,
            disabled: false,
            title: t('title.sound'),
            onClick: function () { setSoundOn(false); writeSound(undefined, 'off') },
          }),
        )

        return h('div', { style: wrap },
          h('button', {
            type: 'button',
            'aria-expanded': open === true,
            title: t('aria.group'),
            onClick: function () { setOpen(!open) },
            style: toggle,
          }, h('span', { style: mark }), t('name')),
          open === true
            ? h('div', { role: 'group', 'aria-label': t('aria.group'), style: panel },
                strengthRow, languageRow, skinRow, soundRow, statusRow)
            : null,
        )
      }

      /* ---------------- 通道 ---------------- */

      function makeSend(ctx, sessionId) {
        return async function send(line) {
          try {
            const outcome = await ctx.remote.commands.execute(sessionId, line, [])
            if (!outcome.ok) {
              const error = outcome.error === undefined ? undefined : outcome.error
              const message = error !== undefined && typeof error.message === 'string' && error.message.length > 0
                ? error.message
                : 'command failed'
              const code = error !== undefined && typeof error.code === 'string' ? ' (' + error.code + ')' : ''
              return { ok: false, text: message + code }
            }
            if (outcome.value === undefined) {
              return { ok: false, text: 'unknown or malformed command: ' + line }
            }
            const result = outcome.value.result
            if (result !== undefined && result.kind === 'error') {
              return { ok: false, text: typeof result.text === 'string' && result.text.length > 0 ? result.text : 'command error' }
            }
            const text = result !== undefined && typeof result.text === 'string' && result.text.length > 0
              ? result.text
              : 'ok'
            return { ok: true, text: text }
          } catch (error) {
            const message = error !== null && typeof error === 'object' && typeof error.message === 'string'
              ? error.message
              : String(error)
            return { ok: false, text: 'command channel unavailable: ' + message }
          }
        }
      }

      function apply(ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, DICTS)
        }, 'naiwa-ism:locale')

        /* 幂等守卫：热替换时先释放上一实例的槽位，避免两条控制条叠字。 */
        const BAR_HANDLE = '__naiwaIsmBarHandle'
        if (typeof globalThis[BAR_HANDLE] === 'function') {
          try { globalThis[BAR_HANDLE]() } catch (_error) { /* 旧实例可能已释放 */ }
        }
        const disposeBar = ctx.slots.inject(SLOT, function () {
          return ctx.slots.register({
            name: SLOT,
            id: 'naiwa-control',
            order: 30,
            locale: NS,
            inject: function (sessionId) {
              return {
                sessionId: sessionId,
                send: makeSend(ctx, sessionId),
                skin: skinBridge,
                watchEnd: function (cb) { return watchTurnEnd(ctx, sessionId, cb) },
              }
            },
          }, NaiwaControl)
        })
        if (typeof disposeBar === 'function') globalThis[BAR_HANDLE] = disposeBar        /* theme 服务获取：先探测（ctx.get），晚到再用延迟注入等它；
         * 顶层 inject 数组不动（G1 逐字锁）。attach 以 skin.bound 幂等。 */
        function attach(theme) {
          if (skin.bound) return
          if (theme === null || theme === undefined || typeof theme.overrideTokens !== 'function') return
          skin.bound = true
          skin.theme = theme
          skinBridge.available = true
          ctx.effect(function () {
            /* 每次加载按存储重放：'on'（含缺失默认）装层，'off' 不装。 */
            if (readStored() === 'on') installLayer(skin, theme)
            return function () {
              removeLayer(skin)
            }
          }, 'naiwa-ism:skin-layer')
          skinBridge.publish()
        }

        if (typeof ctx.get === 'function') {
          try {
            const available = ctx.get('theme')
            if (available) attach(available)
          } catch (_error) {
            /* 服务尚未 provision：走下面的延迟注入。 */
          }
        }
        if (!skin.bound && typeof ctx.inject === 'function') {
          try {
            ctx.inject(['theme'], function (scope) {
              if (scope) attach(scope.theme)
            })
          } catch (_error) {
            /* 旧 client ctx 没有 inject：跳过，皮肤 chip 隐藏，不抛。 */
          }
        }
      }

      return {
        inject: ['slots', 'remote', 'remote.commands', 'locale', 'sessions'],
        apply: apply,
        themeModel: {
          SKIN_KEY: SKIN_KEY,
          SOURCE: SKIN_SOURCE,
          PAIRS: SKIN_PAIRS,
          readStored: readStored,
          setSkin: setSkin,
          skin: skin,
          bridge: skinBridge,
          backdrop: {
            id: BACKDROP_ID,
            css: backdropCss,
            install: installBackdrop,
            remove: removeBackdrop,
          },
          sound: {
            key: SOUND_KEY,
            clips: LAUGH_CLIPS,
            read: readSound,
            write: writeSound,
            play: playLaugh,
            watch: watchTurnEnd,
          },
        },
      }
    },
  })
} else if (typeof console !== 'undefined' && typeof console.warn === 'function') {
  console.warn('naiwa-ism client: window.__ModuleLoader__ is missing; control bar disabled')
}
