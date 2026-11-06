import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PptxPreview } from '../src/pptx-preview.jsx'
import { styles } from '../src/styles.js'

document.head.appendChild(Object.assign(document.createElement('style'), { textContent: styles }))

function PreviewSmoke() {
  const [index, setIndex] = useState(0)
  const [base64, setBase64] = useState(window.samplePptxBase64)
  window.replaceSmokePptx = setBase64
  return <div className="seal-workspace-word" style={{ height: '100vh' }}>
    <PptxPreview base64={base64} index={index} onSelect={setIndex} />
  </div>
}

createRoot(document.getElementById('root')).render(<PreviewSmoke />)
