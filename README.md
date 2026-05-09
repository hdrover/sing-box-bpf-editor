# sing-box BPF editor

Online editor for sing-box `.bpf` profile files (the binary export format of SFA/SFI/SFM clients). Works entirely in your browser — nothing to install, no server, your profiles never leave your device.

**Live:** https://hdrover.github.io/sing-box-bpf-editor/

## What is `.bpf`?

`.bpf` is the binary container used by the official sing-box clients (SFA for Android, SFI/SFM for Apple platforms) for profile export and import. The format is not separately documented; it is defined by the source code of the `libbox` package in the sing-box repository.

A `.bpf` file contains:

- profile name and type (Local or Remote),
- the sing-box JSON config,
- for Remote profiles: source URL, auto-update flag, update interval.

## Usage

1. Open the page.
2. Click **Load .bpf file** to import an existing profile, or fill the form to create a new one from scratch.
3. Edit the fields. The JSON config is shown exactly as it is stored in the file — no formatting, reordering, or validation is applied, so JSONC content (comments, trailing commas) is preserved byte-for-byte.
4. Click **Save .bpf file** to download the result.

## Related

- [sing-box-drover](https://github.com/hdrover/sing-box-drover) — lightweight GUI launcher and tray controller for sing-box on Windows. Quickly toggle system proxy and TUN mode, switch outbound selectors.
- [sing-box](https://github.com/SagerNet/sing-box) — the upstream project.

## License

[MIT](LICENSE)
