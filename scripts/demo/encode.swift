import Foundation
import AVFoundation
import ImageIO
import CoreGraphics

// NDJSON frames from the dedicated CDP tab, encoded with macOS AVFoundation.
let output = URL(fileURLWithPath: CommandLine.arguments[1])
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: 1440, AVVideoHeightKey: 1000,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 5_000_000]
])
let adapter = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input,
    sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: 1440, kCVPixelBufferHeightKey as String: 1000])
input.expectsMediaDataInRealTime = false
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)
var lastBuffer: CVPixelBuffer?
var count = 0
var lastTime: Int64 = 0
while let line = readLine() {
    guard let data = line.data(using: .utf8),
          let frame = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let ms = frame["ms"] as? Int64 else { fatalError("Invalid frame") }
    if let encoded = frame["data"] as? String,
       let bytes = Data(base64Encoded: encoded),
       let source = CGImageSourceCreateWithData(bytes as CFData, nil),
       let image = CGImageSourceCreateImageAtIndex(source, 0, nil) {
        var pixel: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, adapter.pixelBufferPool!, &pixel)
        guard let pixel = pixel else { fatalError("Pixel buffer allocation failed") }
        CVPixelBufferLockBaseAddress(pixel, [])
        let context = CGContext(data: CVPixelBufferGetBaseAddress(pixel), width: 1440, height: 1000,
            bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixel),
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
        context.draw(image, in: CGRect(x: 0, y: 0, width: 1440, height: 1000))
        CVPixelBufferUnlockBaseAddress(pixel, [])
        lastBuffer = pixel
    }
    if let buffer = lastBuffer {
        while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
        let time = max(ms, lastTime + 1)
        guard adapter.append(buffer, withPresentationTime: CMTime(value: time, timescale: 1000)) else {
            fatalError(writer.error?.localizedDescription ?? "Append failed")
        }
        lastTime = time
        count += 1
    }
}
writer.endSession(atSourceTime: CMTime(value: lastTime, timescale: 1000))
input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()
guard writer.status == .completed else { fatalError(writer.error?.localizedDescription ?? "Encoding failed") }
let asset = AVURLAsset(url: output)
let seconds = CMTimeGetSeconds(asset.duration)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
var decoded = 0
for (index, fraction) in [0.01, 0.2, 0.4, 0.6, 0.8, 0.99].enumerated() {
    let frame = try generator.copyCGImage(at: CMTime(seconds: seconds * fraction, preferredTimescale: 1000), actualTime: nil)
    let destination = output.deletingLastPathComponent().appendingPathComponent("video-check-\(index).png")
    let image = CGImageDestinationCreateWithURL(destination as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(image, frame, nil)
    guard CGImageDestinationFinalize(image) else { fatalError("Video frame verification failed") }
    decoded += 1
}
let result: [String: Any] = ["durationMs": Int((seconds * 1000).rounded()), "frames": count,
    "decodedCheckFrames": decoded, "width": 1440, "height": 1000, "codec": "h264", "file": "submission.mp4"]
let json = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: json, encoding: .utf8)!)
