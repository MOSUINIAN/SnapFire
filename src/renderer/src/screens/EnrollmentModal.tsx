import { useEffect, useMemo, useState } from 'react'
import type { AppearanceData, EnrollmentView } from '@shared/types'
import { useCamera } from '../hooks/useCamera'
import { captureEnrollmentFrame, type EnrollmentCapture } from '../vision/enrollment'
import { warmupHuman } from '../vision/human'
import {
  IconAlert,
  IconCamera,
  IconCheck,
  IconClose,
  IconRefresh,
  IconShield
} from '../components/Icons'

interface EnrollmentModalProps {
  cameraDeviceId: string | null
  existing: AppearanceData | null
  onClose: () => void
  onSave: (appearance: AppearanceData) => Promise<void> | void
}

const VIEW_LABEL: Record<EnrollmentView, string> = {
  front: '正面',
  back: '背面',
  left: '左侧',
  right: '右侧',
  other: '其他'
}

const VIEW_HINT: Record<'front' | 'back' | 'left', string> = {
  front: '面对摄像头站好，让上半身或全身进入画面',
  back: '转身背对摄像头，保持同样的位置',
  left: '侧身站立（可选，用于补充侧面特征）'
}

export function EnrollmentModal({
  cameraDeviceId,
  existing,
  onClose,
  onSave
}: EnrollmentModalProps): React.JSX.Element {
  const { videoRef, status, error: cameraError, resolution, start } = useCamera({
    autoStart: true,
    deviceId: cameraDeviceId
  })
  const [captures, setCaptures] = useState<EnrollmentCapture[]>([])
  const [busyView, setBusyView] = useState<EnrollmentView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [engineReady, setEngineReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    warmupHuman()
      .then(() => {
        if (!cancelled) setEngineReady(true)
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? `识别引擎加载失败：${caught.message}`
              : '识别引擎加载失败'
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const byView = useMemo(() => {
    const map = new Map<EnrollmentView, EnrollmentCapture>()
    for (const capture of captures) map.set(capture.view, capture)
    return map
  }, [captures])

  const front = byView.get('front')
  const back = byView.get('back')
  const canSave = Boolean(front && back)

  const capture = async (view: 'front' | 'back' | 'left'): Promise<void> => {
    const video = videoRef.current
    if (!video) return
    setBusyView(view)
    setError(null)
    setNotice(null)
    try {
      const result = await captureEnrollmentFrame(video, view)
      setCaptures((current) => [
        ...current.filter((item) => item.view !== view),
        result
      ])
      if (!result.faceDetected) {
        setNotice('这张画面没有识别到清晰人脸，身份将主要依靠衣着特征（仍然可以保存）。')
      } else {
        setNotice(`已采集${VIEW_LABEL[view]}：人脸 + 衣着特征都提取成功。`)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '采集失败，请重试')
    } finally {
      setBusyView(null)
    }
  }

  const save = async (): Promise<void> => {
    if (!front || !back) {
      setError('请至少采集正面和背面两个视角')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const faceEmbeddings: number[][] = []
      for (const capture of captures) {
        if (capture.faceEmbedding) faceEmbeddings.push(capture.faceEmbedding)
      }
      if (faceEmbeddings.length === 0 && existing?.faceEmbeddings?.length) {
        faceEmbeddings.push(...existing.faceEmbeddings)
      }
      const appearance: AppearanceData = {
        version: 1,
        faceEmbeddings: faceEmbeddings.slice(0, 6),
        clothing: captures.map((item) => item.clothing),
        updatedAt: Date.now(),
        thumbnail: front.thumbnail || captures[0]?.thumbnail
      }
      await onSave(appearance)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存建档失败，请重试')
      setSaving(false)
    }
  }

  const cameraReady = status === 'ready'
  const canCapture = cameraReady && engineReady && !busyView && !saving

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="赛前建档">
      <div className="enroll-modal">
        <header className="modal-head">
          <div>
            <span className="eyebrow">PRE-MATCH ENROLMENT</span>
            <h2>人脸与衣着建档</h2>
          </div>
          <button className="icon-button" onClick={onClose} disabled={saving} aria-label="关闭">
            <IconClose />
          </button>
        </header>

        <div className="enroll-body">
          <div className="enroll-camera">
            <video
              ref={videoRef}
              className="enroll-video"
              autoPlay
              muted
              playsInline
            />
            <div className="enroll-guide" aria-hidden="true">
              <svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet">
                <g fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="2" strokeDasharray="7 8">
                  <circle cx="150" cy="72" r="30" />
                  <path d="M150 102v28" />
                  <path d="M103 132h94" />
                  <path d="M112 132v104h76V132" />
                  <path d="M115 236v112M185 236v112" />
                  <path d="M112 150l-34 70M188 150l34 70" />
                </g>
                <g stroke="rgba(255,164,43,0.55)" strokeWidth="2">
                  <path d="M22 42V22h22M256 22h22v20M278 358v22h-22M44 380H22v-22" />
                </g>
              </svg>
            </div>
            <div className="enroll-camera__status">
              {status === 'starting' && <span className="chip chip--amber">正在打开摄像头…</span>}
              {status === 'error' && <span className="chip chip--red">摄像头不可用</span>}
              {status === 'ready' && (
                <span className="chip chip--green">
                  摄像头已就绪
                  {resolution ? ` · ${resolution.width}×${resolution.height}` : ''}
                </span>
              )}
              {status === 'ready' && !engineReady && (
                <span className="chip chip--amber">识别引擎加载中…</span>
              )}
            </div>
            {cameraError && (
              <div className="enroll-camera__error">
                <IconAlert />
                <span>{cameraError}</span>
                <button className="ghost-button" onClick={() => void start(cameraDeviceId)}>
                  重试
                </button>
              </div>
            )}
          </div>

          <div className="enroll-side">
            <div className="enroll-instructions">
              <h3>采集步骤</h3>
              <ol>
                <li>
                  站在摄像头前 <strong>2~4 米</strong>，让上半身或全身进入画面。
                </li>
                <li>正面采集一次，转身背面再采集一次；侧身可选。</li>
                <li>保持光线充足，避免逆光；衣服颜色/图案越清楚越稳。</li>
              </ol>
              <p className="enroll-tip">
                <IconShield />
                原始照片只保存在本机；房间内只同步识别特征，不上传照片。
              </p>
            </div>

            <div className="capture-buttons">
              <button
                className={`capture-button ${front ? 'is-done' : ''}`}
                onClick={() => void capture('front')}
                disabled={!canCapture}
              >
                <IconCamera />
                <span>{busyView === 'front' ? '分析中…' : '采集正面'}</span>
                {front && <IconCheck className="capture-button__check" />}
              </button>
              <button
                className={`capture-button ${back ? 'is-done' : ''}`}
                onClick={() => void capture('back')}
                disabled={!canCapture}
              >
                <IconCamera />
                <span>{busyView === 'back' ? '分析中…' : '采集背面'}</span>
                {back && <IconCheck className="capture-button__check" />}
              </button>
              <button
                className={`capture-button capture-button--ghost ${byView.get('left') ? 'is-done' : ''}`}
                onClick={() => void capture('left')}
                disabled={!canCapture}
              >
                <IconCamera />
                <span>{busyView === 'left' ? '分析中…' : '采集侧面（可选）'}</span>
                {byView.get('left') && <IconCheck className="capture-button__check" />}
              </button>
            </div>

            <div className="capture-list">
              {(['front', 'back', 'left'] as const).map((view) => {
                const item = byView.get(view)
                return (
                  <div className={`capture-item ${item ? 'is-filled' : ''}`} key={view}>
                    <div className="capture-item__thumb">
                      {item ? (
                        <img src={item.thumbnail} alt={VIEW_LABEL[view]} />
                      ) : (
                        <IconCamera />
                      )}
                    </div>
                    <div className="capture-item__meta">
                      <strong>{VIEW_LABEL[view]}</strong>
                      <span>
                        {item
                          ? item.faceDetected
                            ? '人脸 + 衣着已采集'
                            : '衣着已采集（无清晰人脸）'
                          : VIEW_HINT[view]}
                      </span>
                    </div>
                    {item && item.faceDetected && <span className="mini-ok">FACE OK</span>}
                  </div>
                )
              })}
            </div>

            {notice && !error && (
              <div className="enroll-notice">
                <IconCheck />
                <span>{notice}</span>
              </div>
            )}
            {error && (
              <div className="form-error">
                <IconAlert />
                <span>{error}</span>
              </div>
            )}

            {captures.length > 0 && (
              <button
                className="ghost-button"
                onClick={() => {
                  setCaptures([])
                  setNotice(null)
                  setError(null)
                }}
                disabled={saving}
              >
                <IconRefresh />
                重新采集全部
              </button>
            )}
          </div>
        </div>

        <footer className="modal-foot">
          <div className="modal-foot__hint">
            {existing
              ? '已有一份建档数据；保存后会覆盖旧数据。'
              : '至少采集正面和背面后才能保存。'}
          </div>
          <button className="ghost-button" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            className="primary-button"
            onClick={() => void save()}
            disabled={!canSave || saving}
          >
            {saving ? '保存中…' : '保存建档'}
          </button>
        </footer>
      </div>
    </div>
  )
}
