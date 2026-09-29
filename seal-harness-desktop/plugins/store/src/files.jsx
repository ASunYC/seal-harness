import React, { useEffect, useState } from 'react'
import { FileView } from '../../skills/src/files.jsx'

export function ArtifactFiles({ api, id, version }) {
  const [path, setPath] = useState(undefined)
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState({ files: [], content: null, loading: true })
  useEffect(() => {
    const controller = new AbortController()
    setResult(current => ({ ...current, content: null, message: '', loading: true }))
    api('store/artifactFiles', { collection: 'skills', id, version, ...(path ? { path } : {}) }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setResult(value) })
      .catch(error => { if (!controller.signal.aborted) setResult(current => ({ ...current, loading: false, message: error.message })) })
    return () => controller.abort()
  }, [api, id, version, path, reload])
  return <FileView {...result} path={result.path ?? path} message={result.message || (!result.loading && !result.files.length ? '此版本尚未上传文件。' : '')} select={setPath} actions={result.message && <button onClick={() => setReload(value => value + 1)}>重试读取</button>} />
}
