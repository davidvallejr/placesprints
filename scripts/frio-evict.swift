// Ajudante do arquivamento em streaming (Google Drive para computador = File Provider): consulta se o arquivo já subiu e o «despeja» (evict) do Mac.
// Compilar 1 vez: swiftc -O scripts/frio-evict.swift -o scripts/bin/frio-evict   (o binário é só local; recompile se trocar de Mac)
//   frio-evict status <arquivo...>  → JSON [{arquivo, existe, ubiquo, uploaded, uploading, download, alocado, tamanho, erro_upload}]
//   frio-evict evict <arquivo>      → só se uploaded == true; senão sai 2 sem tocar em nada. Sai 0 com o status depois do pedido de evict.
import Foundation

let chaves: Set<URLResourceKey> = [.isUbiquitousItemKey, .ubiquitousItemIsUploadedKey, .ubiquitousItemIsUploadingKey,
  .ubiquitousItemDownloadingStatusKey, .ubiquitousItemUploadingErrorKey, .totalFileAllocatedSizeKey, .fileAllocatedSizeKey, .fileSizeKey]

func status(_ p: String) -> [String: Any] {
  var u = URL(fileURLWithPath: p)
  u.removeAllCachedResourceValues()
  guard FileManager.default.fileExists(atPath: p) else { return ["arquivo": p, "existe": false] }
  guard let v = try? u.resourceValues(forKeys: chaves) else { return ["arquivo": p, "existe": true, "erro": "sem_atributos"] }
  return ["arquivo": p, "existe": true, "ubiquo": v.isUbiquitousItem ?? false, "uploaded": v.ubiquitousItemIsUploaded ?? false,
          "uploading": v.ubiquitousItemIsUploading ?? false, "download": v.ubiquitousItemDownloadingStatus?.rawValue ?? "",
          "alocado": v.totalFileAllocatedSize ?? v.fileAllocatedSize ?? -1, "tamanho": v.fileSize ?? -1,
          "erro_upload": v.ubiquitousItemUploadingError?.localizedDescription ?? ""]
}
func json(_ o: Any) { print(String(data: try! JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), encoding: .utf8)!) }
func falha(_ m: String, _ c: Int32) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(c) }

let a = Array(CommandLine.arguments.dropFirst())
guard let cmd = a.first else { falha("uso: frio-evict status <arquivo...> | evict <arquivo>", 64) }
switch cmd {
case "status": json(a.dropFirst().map(status))
case "evict":
  guard a.count == 2 else { falha("uso: frio-evict evict <arquivo>", 64) }
  let s = status(a[1])
  guard s["existe"] as? Bool == true else { falha("nao_existe", 2) }
  guard s["uploaded"] as? Bool == true else { falha("nao_subiu", 2) }
  do { try FileManager.default.evictUbiquitousItem(at: URL(fileURLWithPath: a[1])) } catch { falha("evict_falhou: \(error.localizedDescription)", 3) }
  json(status(a[1]))
default: falha("subcomando desconhecido", 64)
}
