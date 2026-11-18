import sys, numpy as np, torch, time
sys.path.insert(0, __file__.rsplit("\\",1)[0] if "\\" in __file__ else ".")
import probe_data
from transformers import AutoModel
from tokenizers import Tokenizer
import onnxruntime as ort
M, O = sys.argv[1], sys.argv[2]
texts = [x for _, p, n in probe_data.WANTS for x in p + n]
for name, d, pool in [("mmlw-roberta-base","sdadas__mmlw-roberta-base","cls"),("pkobp-modernbert-68m","PKOBP__embed-modernbert-68m","cls")]:
    tok = Tokenizer.from_file(f"{M}/{d}/tokenizer.json")
    m = AutoModel.from_pretrained(f"{M}/{d}").float().eval()
    o = ort.SessionOptions(); o.intra_op_num_threads = 1
    sf = ort.InferenceSession(f"{O}/{name}/model.onnx", o); si = ort.InferenceSession(f"{O}/{name}/model_int8.onnx", o)
    cf, ci = [], []
    for t in texts[:15]:
        e = tok.encode(t); ids = np.array([e.ids]); am = np.array([e.attention_mask])
        with torch.no_grad(): h = m(input_ids=torch.tensor(ids), attention_mask=torch.tensor(am)).last_hidden_state[0,0].numpy()
        a = sf.run(None, {"input_ids": ids, "attention_mask": am})[0][0,0]; b = si.run(None, {"input_ids": ids, "attention_mask": am})[0][0,0]
        cos = lambda x, y: float(x @ y / np.linalg.norm(x) / np.linalg.norm(y))
        cf.append(cos(h, a)); ci.append(cos(h, b))
    print(name, "torch-vs-onnx-fp32 min cos", round(min(cf), 5), "torch-vs-int8 min/mean cos", round(min(ci), 4), round(float(np.mean(ci)), 4))
for name in ["mmlw-e5-small", "multilingual-e5-small"]:
    tok = Tokenizer.from_file(f"{M}/sdadas__mmlw-e5-small/tokenizer.json")
    for f in ["model.onnx", "model_int8.onnx"]:
        o = ort.SessionOptions(); o.intra_op_num_threads = 1
        s = ort.InferenceSession(f"{O}/{name}/{f}", o)
        encs = [tok.encode("query: " + t) for t in texts]
        for e in encs[:5]: s.run(None, {"input_ids": np.array([e.ids]), "attention_mask": np.array([e.attention_mask]), "token_type_ids": np.array([e.type_ids])})
        ts = []
        for _ in range(5):
            for e in encs:
                a = time.perf_counter(); s.run(None, {"input_ids": np.array([e.ids]), "attention_mask": np.array([e.attention_mask]), "token_type_ids": np.array([e.type_ids])}); ts.append((time.perf_counter()-a)*1000)
        print(name, f, "median ms", round(float(np.median(ts)), 2), "p95", round(float(np.percentile(ts, 95)), 2))
# batch throughput for mmlw-roberta-base int8: 32 texts padded
tok = Tokenizer.from_file(f"{M}/sdadas__mmlw-roberta-base/tokenizer.json"); tok.enable_padding(pad_id=1, pad_token="<pad>")
for f in ["model.onnx", "model_int8.onnx"]:
    o = ort.SessionOptions(); o.intra_op_num_threads = 1
    s = ort.InferenceSession(f"{O}/mmlw-roberta-base/{f}", o)
    encs = tok.encode_batch(texts[:32]); ids = np.array([e.ids for e in encs]); am = np.array([e.attention_mask for e in encs])
    s.run(None, {"input_ids": ids, "attention_mask": am}); a = time.perf_counter()
    for _ in range(5): s.run(None, {"input_ids": ids, "attention_mask": am})
    print("mmlw-roberta-base", f, "batch32 ms/text", round((time.perf_counter()-a)*1000/5/32, 2))
