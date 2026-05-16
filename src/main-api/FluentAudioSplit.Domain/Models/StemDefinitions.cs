namespace FluentAudioSplit.Domain.Models;

public static class StemDefinitions
{
    public static readonly Dictionary<string, string[]> ModelStems = new()
    {
        ["htdemucs_ft.yaml"] = ["Vocals", "Drums", "Bass", "Other"],
        ["htdemucs.yaml"] = ["Vocals", "Drums", "Bass", "Other"],
        ["htdemucs_6s.yaml"] = ["Vocals", "Drums", "Bass", "Other", "Guitar", "Piano"],
        ["UVR-MDX-NET-Inst_HQ_3.onnx"] = ["Vocals", "Instrumental"],
        ["vocals_mel_band_roformer.ckpt"] = ["Vocals", "Other"],
    };
}
