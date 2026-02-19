import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect, useRef } from 'react'
import { rulesData, RuleSection } from '../../data/rulesData'

interface RulesModalProps {
  isOpen: boolean
  onClose: () => void
}

// 根据 accentColor 返回 Tailwind 色彩配置
const getAccentClasses = (color?: RuleSection['accentColor']) => {
  switch (color) {
    case 'red':    return { border: 'border-red-500/50',    heading: 'from-red-400 to-rose-500',      navActive: 'bg-red-900/40 text-red-300 border-red-500',    navHover: 'hover:border-red-600/50 hover:text-red-200' }
    case 'blue':   return { border: 'border-blue-500/50',   heading: 'from-blue-400 to-cyan-400',     navActive: 'bg-blue-900/40 text-blue-300 border-blue-500',   navHover: 'hover:border-blue-600/50 hover:text-blue-200' }
    case 'green':  return { border: 'border-green-500/50',  heading: 'from-green-400 to-emerald-400', navActive: 'bg-green-900/40 text-green-300 border-green-500',  navHover: 'hover:border-green-600/50 hover:text-green-200' }
    case 'yellow': return { border: 'border-yellow-500/50', heading: 'from-yellow-400 to-amber-400',  navActive: 'bg-yellow-900/40 text-yellow-300 border-yellow-500', navHover: 'hover:border-yellow-600/50 hover:text-yellow-200' }
    default:       return { border: 'border-amber-500/50',  heading: 'from-amber-400 to-yellow-500',  navActive: 'bg-amber-900/40 text-amber-300 border-amber-500',   navHover: 'hover:border-amber-600/50 hover:text-amber-200' }
  }
}

export default function RulesModal({ isOpen, onClose }: RulesModalProps) {
  const [activeSection, setActiveSection] = useState<string>('basics')
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId)
    const element = document.getElementById(`rule-section-${sectionId}`)
    const container = contentRef.current
    if (element && container) {
      container.scrollTo({ top: element.offsetTop - container.offsetTop, behavior: 'smooth' })
    }
  }

  // 格式化行内样式（粗体、数字高亮）
  const formatInlineStyles = (text: string): string => {
    const boldParts: string[] = []
    let processed = text.replace(/\*\*([^*]+)\*\*/g, (_match, content) => {
      boldParts.push(content)
      return `__BOLD${boldParts.length - 1}__`
    })
    processed = processed.replace(/\b(\d+)\b/g, '<span class="text-cyan-400 font-bold">$1</span>')
    processed = processed.replace(/__BOLD(\d+)__/g, (_match, idx) => {
      return `<strong class="text-amber-300 font-bold">${boldParts[parseInt(idx)]}</strong>`
    })
    return processed
  }

  // 渲染每行内容
  const renderContent = (content: string[]) => {
    return content.map((line, index) => {
      // 空行
      if (line === '') return <div key={index} className="h-2" />

      // 分隔线
      if (line === '===') {
        return <hr key={index} className="my-5 border-slate-600/40" />
      }

      // 主动技能卡片：@active:技能名|描述
      if (line.startsWith('@active:')) {
        const rest = line.slice('@active:'.length)
        const sepIdx = rest.indexOf('|')
        const name = sepIdx >= 0 ? rest.slice(0, sepIdx).trim() : rest.trim()
        const desc = sepIdx >= 0 ? rest.slice(sepIdx + 1).trim() : ''
        return (
          <div key={index} className="my-3 rounded-lg border-l-4 border-orange-500 bg-gradient-to-r from-orange-950/50 to-transparent p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-orange-500/30 text-orange-300 uppercase tracking-wide">⚡ 主动</span>
              <span className="text-orange-200 font-bold text-sm">{name}</span>
            </div>
            {desc && <div className="text-gray-200 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: formatInlineStyles(desc) }} />}
          </div>
        )
      }

      // 被动技能卡片：@passive:技能名|描述
      if (line.startsWith('@passive:')) {
        const rest = line.slice('@passive:'.length)
        const sepIdx = rest.indexOf('|')
        const name = sepIdx >= 0 ? rest.slice(0, sepIdx).trim() : rest.trim()
        const desc = sepIdx >= 0 ? rest.slice(sepIdx + 1).trim() : ''
        return (
          <div key={index} className="my-3 rounded-lg border-l-4 border-blue-500 bg-gradient-to-r from-blue-950/50 to-transparent p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-blue-500/30 text-blue-300 uppercase tracking-wide">🔵 被动</span>
              <span className="text-blue-200 font-bold text-sm">{name}</span>
            </div>
            {desc && <div className="text-gray-200 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: formatInlineStyles(desc) }} />}
          </div>
        )
      }

      // 单位标签：@unit:单位名|说明
      if (line.startsWith('@unit:')) {
        const rest = line.slice('@unit:'.length)
        const sepIdx = rest.indexOf('|')
        const name = sepIdx >= 0 ? rest.slice(0, sepIdx).trim() : rest.trim()
        const desc = sepIdx >= 0 ? rest.slice(sepIdx + 1).trim() : ''
        return (
          <div key={index} className="mt-4 mb-2 flex items-center gap-2">
            <span className="inline-block px-2.5 py-1 rounded-full bg-purple-900/60 border border-purple-400/50 text-purple-200 font-bold text-sm">
              【{name}】
            </span>
            {desc && <span className="text-gray-400 text-xs">{desc}</span>}
          </div>
        )
      }

      // 特殊规则标题：@special:标题
      if (line.startsWith('@special:')) {
        const title = line.slice('@special:'.length).trim()
        return (
          <div key={index} className="mt-5 mb-3 px-3 py-2 rounded-lg bg-yellow-900/30 border border-yellow-600/40 flex items-center gap-2">
            <span className="text-yellow-400 text-base">⭐</span>
            <span className="text-yellow-300 font-bold">{title}</span>
          </div>
        )
      }

      // 粗体标题 **文字**
      if (line.startsWith('**') && line.endsWith('**')) {
        return (
          <h3 key={index} className="text-xl font-bold text-amber-400 mt-5 mb-3">
            {line.slice(2, -2)}
          </h3>
        )
      }

      // 列表项 • 或 -
      if (line.trim().startsWith('•') || line.trim().startsWith('-')) {
        const text = line.replace(/^[•\-]\s*/, '')
        const indent = line.search(/[•\-]/)
        return (
          <div key={index} className="text-gray-200 mb-1.5 flex items-start leading-relaxed" style={{ paddingLeft: `${indent * 8}px` }}>
            <span className="text-amber-500 mr-2 flex-shrink-0 font-bold">•</span>
            <span dangerouslySetInnerHTML={{ __html: formatInlineStyles(text) }} />
          </div>
        )
      }

      // 普通段落
      return (
        <p key={index} className="text-gray-200 mb-2 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: formatInlineStyles(line) }} />
      )
    })
  }

  // 构建导航组（按 group 分组）
  const navGroups: { label?: string; sections: RuleSection[] }[] = []
  let currentGroup: string | undefined = undefined
  for (const section of rulesData) {
    if (section.group !== currentGroup) {
      navGroups.push({ label: section.group, sections: [section] })
      currentGroup = section.group
    } else {
      navGroups[navGroups.length - 1].sections.push(section)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden border-2 border-amber-500/50"
            >
              {/* 顶部标题栏 */}
              <div className="bg-gradient-to-r from-amber-900/40 via-orange-900/40 to-amber-900/40 backdrop-blur-sm px-6 py-5 border-b-2 border-amber-500/50 flex items-center justify-between flex-shrink-0">
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-400 flex items-center gap-3">
                  <span className="text-4xl">📖</span>
                  十元棋游戏规则书
                </h2>
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-amber-400 text-4xl leading-none transition-colors hover:scale-110 transform"
                  aria-label="关闭"
                >
                  ×
                </button>
              </div>

              {/* 主体区域 */}
              <div className="flex flex-1 overflow-hidden min-h-0">
                {/* 左侧导航 */}
                <nav className="w-44 md:w-52 bg-slate-800/50 backdrop-blur-sm border-r-2 border-slate-700/50 overflow-y-auto flex-shrink-0">
                  {navGroups.map((group, gi) => (
                    <div key={gi}>
                      {group.label && (
                        <div className="px-4 pt-4 pb-1 text-xs text-slate-500 uppercase tracking-wider font-bold select-none">
                          {group.label}
                        </div>
                      )}
                      {group.sections.map((section) => {
                        const accent = getAccentClasses(section.accentColor)
                        const isActive = activeSection === section.id
                        return (
                          <button
                            key={section.id}
                            onClick={() => scrollToSection(section.id)}
                            className={`w-full text-left px-4 py-3 transition-all border-l-4 font-medium text-sm flex items-center gap-2 ${
                              isActive
                                ? `${accent.navActive} shadow-sm`
                                : `text-gray-300 hover:bg-slate-700/50 border-transparent ${accent.navHover}`
                            }`}
                          >
                            {section.icon && <span className="text-base leading-none">{section.icon}</span>}
                            <span>{section.title}</span>
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </nav>

                {/* 右侧内容区 */}
                <div ref={contentRef} className="flex-1 overflow-y-auto p-6 md:p-10 bg-gradient-to-br from-slate-900/80 to-slate-800/80 min-w-0">
                  {rulesData.map((section) => {
                    const accent = getAccentClasses(section.accentColor)
                    return (
                      <section
                        key={section.id}
                        id={`rule-section-${section.id}`}
                        className="mb-16 scroll-mt-4"
                      >
                        {/* 章节标题 */}
                        <div className={`flex items-center gap-3 mb-6 pb-4 border-b-2 ${accent.border}`}>
                          {section.icon && (
                            <span className="text-4xl leading-none">{section.icon}</span>
                          )}
                          <div>
                            <h2 className={`text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r ${accent.heading}`}>
                              {section.title}
                            </h2>
                            {section.subtitle && (
                              <p className="text-gray-400 text-sm mt-1 font-medium">{section.subtitle}</p>
                            )}
                          </div>
                        </div>

                        {/* 内容 */}
                        <div className="space-y-0.5">
                          {renderContent(section.content)}
                        </div>
                      </section>
                    )
                  })}

                  {/* 底部提示 */}
                  <div className="mt-16 pt-8 border-t border-slate-700/50 text-center text-gray-400 text-sm">
                    <p>按 <kbd className="px-2 py-1 bg-slate-700 rounded text-amber-300 font-mono">ESC</kbd> 键或点击背景关闭规则书</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
