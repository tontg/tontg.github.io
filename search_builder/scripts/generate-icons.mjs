import sharp from 'sharp';

await Promise.all(
  [192, 512].map((size) =>
    sharp('icons/icon.svg')
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(`icons/icon-${size}.png`),
  ),
);
