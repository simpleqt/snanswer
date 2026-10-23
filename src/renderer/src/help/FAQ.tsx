import { BookOpen } from 'lucide-react'
import ShortcutRenderer from '@/components/ShortcutRenderer'
import { platformAlt } from '@/lib/utils/env'
import { HelpSection } from './components'

const faqs = [
  {
    question: '如何截取屏幕截图？',
    answer: (
      <span>
        按下
        <ShortcutRenderer shortcut={`${platformAlt}+Enter`} className="text-xs mx-1" />
        快捷键即可截取当前屏幕的截图。截图会自动显示在应用中。
      </span>
    )
  },
  {
    question: '按下截屏快捷键没反应怎么办？',
    answer: (
      <span>
        个别客户端（监考、安全管控、部分会议软件）会占用或拦截系统屏幕采集，导致截屏拿不到画面。应用会自动重试并切换备用截屏方式；若仍失败，会在解答区顶部显示「截屏失败」提示。此时建议退出相关客户端后重试，或开启「手机显示模式」，由手机端按钮触发截屏并在手机上查看解答。
      </span>
    )
  },
  {
    question: '「手机显示」扫码或输入地址后一直转圈？',
    answer: (
      <span>
        依次检查两点：① 电脑上装有 Tailscale 等虚拟网卡时，地址列表会包含虚拟网卡的地址（已排在真实
        Wi-Fi 地址之后，并标注「基本无法连接」），请优先使用 192.168.x.x 这类地址；② Windows
        防火墙会拦截服务端口的入站连接（即使服务显示「运行中」）。到「设置 →
        手机显示」中复制防火墙放行命令，以管理员身份运行一次即可。
      </span>
    )
  },
  {
    question: '手机端的「极简模式」是什么？',
    answer: (
      <span>
        顶栏点「极简」进入：全屏只显示答案、屏幕常亮，界面只保留底部两个大按钮（📷 截屏 /
        追加截图）和右上角一个小的 ✕ 退出按钮。大按钮单手盲按即可，适合面试中使用。
      </span>
    )
  },
  {
    question: '如何处理题目超过一屏的情况？',
    answer: (
      <span>
        按下
        <ShortcutRenderer shortcut={`${platformAlt}+Shift+Enter`} className="text-xs mx-1" />
        快捷键即可在当前对话中追加截图并生成解题建议。
      </span>
    )
  },
  {
    question: '分享屏幕时，对方能看到应用吗？',
    answer: (
      <span>
        工具窗口在共享屏幕时自动隐藏(对方不可见)，但小部分会议软件可能需要配置才能隐藏。所以如果你对隐身功能有需求，务必在正式使用前用「当前电脑」+「当前会议软件」测试一下。更多细节请到{' '}
        <a
          href="https://github.com/simpleqt/snanswer/issues"
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 hover:underline"
        >
          GitHub Issues
        </a>
        。
      </span>
    )
  },
  {
    question: '鼠标移过窗口时，光标会不会变？',
    answer: (
      <span>
        本工具提供了开关，可以开启或关闭鼠标穿透。开启鼠标穿透时，窗口对鼠标隐身，你需要通过快捷键来操作窗口。切换「鼠标穿透」开关的快捷键是{' '}
        <ShortcutRenderer shortcut={`${platformAlt}+M`} className="text-xs" />{' '}
        。窗口右下角会显示当前状态。
      </span>
    )
  },
  {
    question: '语音转录功能是什么？如何使用？',
    answer: (
      <span>
        语音转录功能可以实时将面试官的语音或题目朗读转为文字，辅助 AI
        更好地理解题意。使用前需在「设置」中配置百炼平台 API Key，然后按下
        <ShortcutRenderer shortcut={`${platformAlt}+T`} className="text-xs mx-1" />
        开始/暂停转录。转录文本会在截图时自动附带提交给 AI。
      </span>
    )
  },
  {
    question: '转录的文本可以单独清除吗？',
    answer: (
      <span>
        可以。按下
        <ShortcutRenderer shortcut={`${platformAlt}+Shift+T`} className="text-xs mx-1" />
        即可清除当前转录文本，清除后的文本不会提交给 AI。截图时也会自动清除已有转录文本。
      </span>
    )
  }
]

export function FAQ() {
  return (
    <HelpSection Icon={BookOpen} title="常见问题">
      {faqs.map((faq, index) => (
        <div key={index} className="border border-gray-400 rounded-lg p-4">
          <h3 className="font-semibold mb-2">{faq.question}</h3>
          <p className="text-sm text-gray-700">{faq.answer}</p>
        </div>
      ))}
    </HelpSection>
  )
}
