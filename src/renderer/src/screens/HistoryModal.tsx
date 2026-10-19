import { useMemo, useState } from 'react'
import type { HistoryData, ProfileData } from '@shared/types'
import { IconClose, IconHistory, IconTrash, IconAlert } from '../components/Icons'
import { formatDateTime, formatPercent } from '../utils/format'
import type { ToastTone } from '../types'

interface HistoryModalProps {
  history: HistoryData
  profile: ProfileData
  onClose: () => void
  onClear: () => Promise<void> | void
  showToast: (message: string, tone?: ToastTone) => void
}

export function HistoryModal({
  history,
  profile,
  onClose,
  onClear,
  showToast
}: HistoryModalProps): React.JSX.Element {
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState(false)

  const summary = useMemo(() => {
    let wins = 0
    let kills = 0
    let deaths = 0
    let shots = 0
    let hits = 0
    for (const match of history.matches) {
      const me = match.players.find((player) => player.id === profile.id)
      if (!me) continue
      kills += me.kills
      deaths += me.deaths
      shots += me.shots
      hits += me.hits
      if (match.winner === me.team) wins += 1
    }
    return {
      matches: history.matches.length,
      wins,
      kills,
      deaths,
      accuracy: shots > 0 ? hits / shots : 0
    }
  }, [history, profile.id])

  const clear = async (): Promise<void> => {
    setBusy(true)
    try {
      await onClear()
      showToast('历史战绩已清空', 'success')
      setConfirmClear(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="历史战绩">
      <div className="history-modal">
        <header className="modal-head">
          <div>
            <span className="eyebrow">LOCAL / MATCH HISTORY</span>
            <h2>历史战绩</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <IconClose />
          </button>
        </header>

        <div className="history-summary">
          <div>
            <span>总场次</span>
            <strong>{summary.matches}</strong>
          </div>
          <div>
            <span>胜场</span>
            <strong>{summary.wins}</strong>
          </div>
          <div>
            <span>击杀</span>
            <strong>{summary.kills}</strong>
          </div>
          <div>
            <span>死亡</span>
            <strong>{summary.deaths}</strong>
          </div>
          <div>
            <span>命中率</span>
            <strong>{formatPercent(summary.accuracy)}</strong>
          </div>
        </div>

        <div className="history-list">
          {history.matches.length === 0 ? (
            <div className="empty-state empty-state--large">
              <IconHistory />
              <span>还没有比赛记录</span>
              <small>完成一局巷战团战后，记录会保存在这里</small>
            </div>
          ) : (
            history.matches.map((match) => {
              const me = match.players.find((player) => player.id === profile.id)
              const outcome =
                match.winner === 'draw'
                  ? '平局'
                  : me
                    ? match.winner === me.team
                      ? '胜利'
                      : '失败'
                    : match.winner === 'red'
                      ? '红队胜'
                      : '蓝队胜'
              const tone =
                outcome === '胜利'
                  ? 'win'
                  : outcome === '失败'
                    ? 'loss'
                    : 'draw'
              return (
                <article className="history-row" key={match.matchId}>
                  <div className="history-row__date">
                    <span>{formatDateTime(match.endedAt)}</span>
                    <small>
                      巷战 · {match.durationMin} 分钟 / {match.killLimit} 杀
                    </small>
                  </div>
                  <div className="history-row__teams">
                    <span className="team-pill team-pill--red">
                      红 {match.score.red}
                    </span>
                    <span className="history-row__colon">:</span>
                    <span className="team-pill team-pill--blue">
                      蓝 {match.score.blue}
                    </span>
                  </div>
                  <span className={`outcome-tag outcome-tag--${tone}`}>{outcome}</span>
                  <div className="history-row__personal">
                    {me ? (
                      <>
                        <span>
                          K/D <strong>{me.kills}</strong> / <strong>{me.deaths}</strong>
                        </span>
                        <span>命中率 {formatPercent(me.accuracy)}</span>
                      </>
                    ) : (
                      <span>无本地玩家数据</span>
                    )}
                  </div>
                </article>
              )
            })
          )}
        </div>

        <footer className="modal-foot">
          <div className="modal-foot__hint">
            本机最多保留最近 50 场；比赛结束时自动写入。
          </div>
          {!confirmClear ? (
            <button
              className="ghost-button danger-text"
              onClick={() => setConfirmClear(true)}
              disabled={history.matches.length === 0}
            >
              <IconTrash />
              清空战绩
            </button>
          ) : (
            <div className="inline-confirm">
              <IconAlert />
              <span>确定清空全部历史战绩？</span>
              <button className="ghost-button" onClick={() => setConfirmClear(false)} disabled={busy}>
                取消
              </button>
              <button className="danger-button" onClick={() => void clear()} disabled={busy}>
                {busy ? '清空中…' : '确认清空'}
              </button>
            </div>
          )}
          <button className="secondary-button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
