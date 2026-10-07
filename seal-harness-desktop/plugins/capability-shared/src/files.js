export async function readZip(file, maxMiB = 64) {
  if (!file || file.size > maxMiB * 1024 * 1024) throw new Error(`请选择不超过 ${maxMiB} MiB 的 ZIP 文件。`)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('无法读取所选文件。'))
    reader.readAsDataURL(file)
  })
}

export function downloadZip({ fileName, contentBase64 }) {
  const bytes = Uint8Array.from(atob(contentBase64), character => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
