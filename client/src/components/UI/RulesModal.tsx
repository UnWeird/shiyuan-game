import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect, useRef } from 'react'
import { rulesData, RuleSection } from '../../data/rulesData'

interface RulesModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function RulesModal({ isOpen, onClose }: RulesModalProps) {
  const [activeSection, setActiveSection] = useState<string>('basics')
  const contentRef = useRef<HTMLDivElement>(null)

  // 监听 ESC 键关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  // 滚动到指定章节
  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId)
    const element = document.getElementById(`rule-section-${sectionId}`)
    const container = contentRef.current

    if (element && container) {
      const containerTop = container.offsetTop
      const elementTop = element.offsetTop
      const offset = elementTop - containerTop

      container.scrollTo({
        top: offset,
        behavior: 'smooth'
      })
    }
  }

  // 渲染规则内容，支持 Markdown 样式
  const renderContent = (content: string[]) => {
    return content.map((line, index) => {
      // 空行
      if (line === '') {
        return <div key={index} className="h-3" />
      }

      // 粗体标题 **文字**
      if (line.startsWith('**') && line.endsWith('**')) {
        const text = line.slice(2, -2)
        return (
          <h3 key={index} className="text-xl font-bold text-amber-400 mt-5 mb-3">
            {text}
          </h3>
        )
      }

      // 列表项 • 或 -
      if (line.trim().startsWith('•') || line.trim().startsWith('-')) {
        const text = line.replace(/^[•\-]\s*/, '')
        const indent = line.search(/[•\-]/)
        return (
          <div
            key={index}
            className="text-gray-200 mb-2 flex items-start leading-relaxed"
            style={{ paddingLeft: `${indent * 8}px` }}
          >
            <span className="text-amber-500 mr-2 flex-shrink-0 font-bold">•</span>
            <span dangerouslySetInnerHTML={{ __html: formatInlineStyles(text) }} />
          </div>
        )
      }

      // 普通段落
      return (
        <p
          key={index}
          className="text-gray-200 mb-2 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: formatInlineStyles(line) }}
        />
      )
    })
  }

  // 格式化行内样式（粗体、数字高亮等）
  const formatInlineStyles = (text: string): string => {
    // 简单方案：只处理没有 ** 包裹的数字
    // 先将 **内容** 暂时替换为占位符，处理完数字后再还原
    const boldParts: string[] = []

    // 提取所有 **粗体** 内容
    let processed = text.replace(/\*\*([^*]+)\*\*/g, (match, content) => {
      boldParts.push(content)
      return `__BOLD${boldParts.length - 1}__`
    })

    // 对剩余文本的数字进行高亮
    processed = processed.replace(/\b(\d+)\b/g, '<span class="text-cyan-400 font-bold">$1</span>')

    // 恢复粗体内容
    processed = processed.replace(/__BOLD(\d+)__/g, (match, idx) => {
      return `<strong class="text-amber-300 font-bold">${boldParts[parseInt(idx)]}</strong>`
    })

    return processed
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 遮罩层 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          >
            {/* 模态内容 */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden border-2 border-amber-500/50"
            >
              {/* 顶部标题栏 */}
              <div className="bg-gradient-to-r from-amber-900/40 via-orange-900/40 to-amber-900/40 backdrop-blur-sm px-6 py-5 border-b-2 border-amber-500/50 flex items-center justify-between">
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
              <div className="flex flex-1 overflow-hidden">
                {/* 左侧导航 */}
                <nav className="w-52 bg-slate-800/50 backdrop-blur-sm border-r-2 border-slate-700/50 overflow-y-auto">
                  {rulesData.map((section) => (
                    <button
                      key={section.id}
                      onClick={() => scrollToSection(section.id)}
                      className={`w-full text-left px-5 py-4 transition-all border-l-4 font-medium ${
                        activeSection === section.id
                          ? 'bg-gradient-to-r from-amber-900/40 to-orange-900/30 text-amber-300 border-amber-500 shadow-lg'
                          : 'text-gray-300 hover:bg-slate-700/50 border-transparent hover:border-amber-600/50 hover:text-amber-200'
                      }`}
                    >
                      {section.title}
                    </button>
                  ))}
                </nav>

                {/* 右侧内容区 */}
                <div ref={contentRef} className="flex-1 overflow-y-auto p-10 bg-gradient-to-br from-slate-900/80 to-slate-800/80">
                  {rulesData.map((section) => (
                    <section
                      key={section.id}
                      id={`rule-section-${section.id}`}
                      className="mb-16 scroll-mt-4"
                    >
                      <h2 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-500 mb-6 pb-4 border-b-2 border-gradient-to-r border-amber-500/50">
                        {section.title}
                      </h2>
                      <div className="space-y-2 backdrop-blur-sm">{renderContent(section.content)}</div>
                    </section>
                  ))}

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
