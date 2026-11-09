# WebXR Input Profiles controller assets

The unmodified controller models and profile descriptions in this directory are
from `@webxr-input-profiles/assets@1.0.20`, published by the Immersive Web community.
The matching profile layouts are already bundled by `@iwsdk/xr-input`.

Source repository: https://github.com/immersive-web/webxr-input-profiles

Published archive: https://registry.npmjs.org/@webxr-input-profiles/assets/-/assets-1.0.20.tgz

Archive SHA-256: `30df2a2268220fc0d0e034bed1550aabdd7a2500573c5216f64fc70d59c3d91e`

Included profiles, with their original left/right GLBs and `profile.json`:

- `meta-quest-touch-plus-v2`
- `meta-quest-touch-plus`
- `meta-quest-touch-pro`
- `oculus-touch-v3` (Quest 2 Touch)
- `oculus-touch-v2` (Quest / Rift S Touch)

These assets use the **MIT License, Copyright (c) 2019 Amazon**. The published
package README explicitly applies MIT to the glTF/GLB assets, as well as the
profile descriptions. See the original [LICENSE.md](./LICENSE.md) and
[README.upstream.md](./README.upstream.md); no separate asset license or copyright
was embedded in these GLBs. `manifest.json` records file sizes and SHA-256 hashes.

The original controller appearance is preserved. Some models depict device
manufacturer trademarks. As the upstream README explains, the asset license does
not grant trademark rights or permission to use those marks for endorsement or
promotion. This project uses the models to depict matching physical controllers.

Loading uses Three.js `GLTFLoader`, and button/stick animation uses Meta IWSDK's
public `AnimatedController` implementation. Those libraries retain their own MIT
license notices in the project's third-party notices.
