// 布局移植自 Stratex VaultLibraryCollectionDetailDialog / VaultLibraryDialogs。
import React, { useRef, useState } from 'react'
import { collectionCategory, Modal, DropZone, canManage, canShare, description, formatSize, stateNames } from './ui.jsx'
import { Icon } from '../../capability-shared/src/icons.jsx'
import { SharingUsers } from './sharing.jsx'

export function CollectionDetail({
  group,
  detail,
  loading,
  error,
  busy,
  installed,
  targetType,
  api,
  close,
  edit,
  archive,
  install,
  uninstall,
  use,
  share,
  upload,
  preview,
  download,
  retry,
  remove,
  search
}) {
  const [tab, setTab] = useState('overview')
  const manage = canManage(group),
    owner = canShare(group)
  const footer = (
    <>
      {owner && (
        <>
          <button className="btn btn--danger" disabled={busy} onClick={archive}>
            删除资料集
          </button>
          <button className="btn btn--ghost" onClick={edit}>
            配置资料集
          </button>
        </>
      )}
      {installed ? (
        <button className="btn btn--ghost" disabled={busy} onClick={uninstall}>
          卸载
        </button>
      ) : (
        group.installable && (
          <button className="btn btn--primary" disabled={busy} onClick={install}>
            安装
          </button>
        )
      )}
      {installed && group.conversationReady && (
        <button className="btn btn--primary" disabled={busy} onClick={use}>
          添加至会话
        </button>
      )}
      <button className="btn btn--ghost" onClick={close}>
        关闭
      </button>
    </>
  )
  return (
    <Modal
      wide
      title={group.name}
      description={`${group.fileCount} 份资料 · 版本 ${group.revision} · ${collectionCategory(group) === 'development' ? '开发类' : '办公类'}`}
      close={close}
      footer={footer}
    >
      <div className="collection-detail">
        <nav className="collection-detail__tabs" aria-label="资料集详情">
          {[
            ['overview', '概览'],
            ['files', `资料文件 ${detail?.files.length ?? group.fileCount}`],
            ['search', '检索']
          ].map(([id, label]) => (
            <button className={tab === id ? 'is-active' : ''} type="button" key={id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
        {tab === 'overview' && (
          <section className="collection-detail__overview">
            <div className="collection-detail__summary">
              <span className="collection-detail__icon">
                <Icon name="library" size={26} />
              </span>
              <div>
                <h3>资料集说明</h3>
                <p>{description(group)}</p>
              </div>
            </div>
            {!!group.analysis?.topics.length && (
              <div className="collection-detail__topics">
                <strong>核心主题</strong>
                <div>
                  {group.analysis.topics.map((topic) => (
                    <span key={topic}>{topic}</span>
                  ))}
                </div>
              </div>
            )}
            <dl className="collection-detail__facts">
              {[
                ['访问范围', group.visibility === 'organization' ? '组织内公开' : '私有'],
                [
                  '当前权限',
                  group.lifecycle === 'archived'
                    ? '已归档'
                    : group.access === 'owner'
                      ? '所有者'
                      : group.access === 'editor'
                        ? '可编辑'
                        : '可查看'
                ],
                ['安装状态', installed ? stateNames[installed.status] : group.installable ? '可安装' : '尚未就绪'],
                ['处理状态', stateNames[group.analysis?.status] || stateNames[group.lifecycle]]
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {group.analysis && (
              <details className="knowledge-analysis">
                <summary>知识整理详情</summary>
                <p>{group.analysis.summary || '索引或分析尚未完成。'}</p>
                <p>关键词：{group.analysis.keywords.join('、') || '暂无'}</p>
                {[
                  ['relations', '关联'],
                  ['conflicts', '冲突'],
                  ['gaps', '缺口']
                ].map(([key, label]) => (
                  <section key={key}>
                    <h4>{label}</h4>
                    {group.analysis[key].length ? (
                      group.analysis[key].map((item, i) => (
                        <p key={i}>
                          <strong>{item.title}</strong> {item.description}
                        </p>
                      ))
                    ) : (
                      <p>暂无</p>
                    )}
                  </section>
                ))}
              </details>
            )}
            <section className="collection-detail__share" aria-label="分享与权限">
              <h3>分享与权限</h3>
              {owner ? (
                <div className="collection-share-methods">
                  {targetType === 'platform' && (
                    <section className="collection-share-method">
                      <h4>用户授权</h4>
                      <p>授权会覆盖整个资料集及其中的文件。选择用户后授予查看或编辑权限。</p>
                      <SharingUsers api={api} groupId={group.id} busy={busy} />
                    </section>
                  )}
                  {targetType === 'standalone' && (
                    <section className="collection-share-method">
                      <h4>授权码</h4>
                      <p>适用于没有用户目录的内网环境。连接同一知识库服务的同事可凭码领取只读权限。</p>
                      <button className="btn btn--primary collection-share-code" disabled={busy} onClick={share}>
                        生成授权码
                      </button>
                    </section>
                  )}
                </div>
              ) : (
                <p>
                  {group.lifecycle === 'archived' ? '资料集已归档，无法继续安装或分享。' : '分享由资料集所有者管理。'}
                </p>
              )}
            </section>
          </section>
        )}
        {tab === 'files' && (
          <section className="collection-detail__files">
            <header>
              <div>
                <h3>资料文件</h3>
                <p>文件只在当前资料集内管理，不作为独立安装或分享单元。</p>
              </div>
              {manage && (
                <button className="btn btn--primary" disabled={busy} onClick={() => upload([])}>
                  导入资料
                </button>
              )}
            </header>
            {manage && <DropZone disabled={busy} choose={() => upload([])} drop={upload} />}
            {loading ? (
              <div className="collection-detail__empty" role="status">
                <strong>正在读取资料文件</strong>
                <p>请稍候。</p>
              </div>
            ) : detail?.files.length ? (
              <ul>
                {detail.files.map((file) => (
                  <li key={file.id}>
                    <span className="collection-file__icon">
                      <Icon name="folder" />
                    </span>
                    <span className="collection-file__copy">
                      <strong>{file.fileName}</strong>
                      <small>
                        {formatSize(file.sizeBytes)} · {stateNames[file.status]}
                      </small>
                      {file.errorMessage && <small role="alert">{file.errorMessage}</small>}
                      {file.parseEngine && (
                        <small>
                          {file.parseEngine}
                          {file.parseMs !== undefined && ` · 解析 ${file.parseMs}ms`}
                          {file.indexMs !== undefined && ` · 索引 ${file.indexMs}ms`}
                        </small>
                      )}
                    </span>
                    <div className="collection-file__actions">
                      <button disabled={busy} onClick={() => preview(file)}>
                        预览
                      </button>
                      <button disabled={busy} onClick={() => download(file)}>
                        下载
                      </button>
                      {manage && (
                        <>
                          {file.status === 'failed' && (
                            <button disabled={busy} onClick={() => retry(file)}>
                              重试索引
                            </button>
                          )}
                          <button className="is-danger" disabled={busy} onClick={() => remove(file)}>
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="collection-detail__empty">
                <strong>资料集还是空的</strong>
                <p>导入第一份文件后，服务端会开始解析、切片和知识整理。</p>
              </div>
            )}
          </section>
        )}
        {tab === 'search' && <section className="collection-detail__files">{search}</section>}
      </div>
    </Modal>
  )
}

export function UploadDialog({ group, initialFiles, progress, error, start, cancel, close }) {
  const [files, setFiles] = useState(initialFiles),
    [invalid, setInvalid] = useState('')
  const input = useRef(null)
  function add(incoming) {
    const invalidFile = incoming.find(
      (file) => !file.size || file.size > 1024 ** 3 || /^(audio|video)\//.test(file.type)
    )
    if (invalidFile) {
      setInvalid(`「${invalidFile.name}」不支持上传：文件须非空、小于 1 GB，且不是音频或视频。`)
      return
    }
    setInvalid('')
    setFiles((current) => [
      ...new Map([...current, ...incoming].map((file) => [`${file.name}:${file.size}`, file])).values()
    ])
  }
  const busy = !!progress
  return (
    <Modal
      title="上传资料"
      description="先确认资料集，再一次导入一份或多份文件；音频和视频暂不支持。"
      close={close}
      footer={
        <>
          <button className="btn btn--ghost" onClick={busy ? cancel : close}>
            {busy ? '取消上传' : '取消'}
          </button>
          <button
            className="btn btn--primary"
            disabled={busy || !files.length || !!invalid}
            onClick={() => start(files)}
          >
            {busy ? '正在上传…' : `开始上传${files.length ? `（${files.length}）` : ''}`}
          </button>
        </>
      }
    >
      <div className="upload-dialog-content">
        <input
          type="file"
          multiple
          hidden
          ref={input}
          onChange={(event) => {
            add([...event.target.files])
            event.target.value = ''
          }}
        />
        <DropZone disabled={busy} choose={() => input.current.click()} drop={add} />
        {(invalid || error) && (
          <p className="dialog-error" role="alert">
            {invalid || error}
          </p>
        )}
        <div className="upload-target">
          <span>
            <strong>存入资料集</strong>
            <small>资料集是安装和加入会话的最小单元。</small>
          </span>
          <strong>{group.name}</strong>
        </div>
        {!!files.length && (
          <>
            <div className="upload-category-hint">
              <strong>待上传文件</strong>
              <span>沿用资料集的{collectionCategory(group) === 'development' ? '开发类' : '办公类'}分类</span>
            </div>
            <ul className="file-queue">
              {files.map((file) => (
                <li key={`${file.name}:${file.size}`}>
                  <div className="file-queue__details">
                    <strong>{file.name}</strong>
                    <small>{formatSize(file.size)}</small>
                  </div>
                  <small className="file-queue__status">
                    {progress?.name === file.name
                      ? `${progress.phase} ${progress.percent}%`
                      : busy
                        ? '等待上传'
                        : '待上传'}
                  </small>
                  <button
                    className="file-queue__remove"
                    disabled={busy}
                    aria-label={`移除 ${file.name}`}
                    onClick={() => setFiles(files.filter((item) => item !== file))}
                  >
                    <Icon name="close" size={15} />
                  </button>
                  {progress?.name === file.name && (
                    <progress max="100" value={progress.percent} aria-label={`${file.name} 上传进度`} />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}
