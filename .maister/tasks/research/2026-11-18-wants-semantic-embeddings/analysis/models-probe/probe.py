import sys, os, json, time, gc
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_data import WANTS
import torch, onnxruntime as ort, psutil
from tokenizers import Tokenizer
from transformers import AutoModel
from onnxruntime.quantization import quantize_dynamic, QuantType

MROOT, OUT = sys.argv[1], sys.argv[2]
only = sys.argv[3].split(",") if len(sys.argv) > 3 else None
# name, dir, pooling, modes {mode: (want_prefix, listing_prefix)}
MODELS = [
 ("mmlw-e5-small", "sdadas__mmlw-e5-small", "cls", {"sym": ("query: ", "query: "), "asym": ("query: ", "passage: ")}),
 ("mmlw-roberta-base", "sdadas__mmlw-roberta-base", "cls", {"sym": ("zapytanie: ", "zapytanie: "), "asym": ("zapytanie: ", "")}),
 ("multilingual-e5-small", "intfloat__multilingual-e5-small", "mean", {"sym": ("query: ", "query: "), "asym": ("query: ", "passage: ")}),
 ("paraphrase-ml-MiniLM-L12-v2", "sentence-transformers__paraphrase-multilingual-MiniLM-L12-v2", "mean", {"none": ("", "")}),
 ("granite-107m-multilingual", "ibm-granite__granite-embedding-107m-multilingual", "cls", {"none": ("", "")}),
 ("pkobp-modernbert-68m", "PKOBP__embed-modernbert-68m", "cls", {"sts": ("[sts]: ", "[sts]: "), "query": ("[query]: ", "")}),
]

wants = [w for w, _, _ in WANTS]
listings = sorted({x for _, p, n in WANTS for x in p + n})
pos = {(w, x) for w, p, _ in WANTS for x in p}
hard = {(w, x) for w, _, n in WANTS for x in n}

class Wrap(torch.nn.Module):
    def __init__(s, m, tti): super().__init__(); s.m = m; s.tti = tti
    def forward(s, input_ids, attention_mask, token_type_ids=None):
        kw = dict(input_ids=input_ids, attention_mask=attention_mask)
        if s.tti: kw["token_type_ids"] = token_type_ids
        return s.m(**kw).last_hidden_state

def export(mdir, odir):
    os.makedirs(odir, exist_ok=True)
    f32, i8 = f"{odir}/model.onnx", f"{odir}/model_int8.onnx"
    if not os.path.exists(f32):
        m = AutoModel.from_pretrained(mdir, attn_implementation="eager").float().eval()
        tti = m.config.model_type in ("bert",)
        ids = torch.ones(1, 8, dtype=torch.long); mask = torch.ones(1, 8, dtype=torch.long)
        args = (ids, mask, torch.zeros(1, 8, dtype=torch.long)) if tti else (ids, mask)
        names = ["input_ids", "attention_mask"] + (["token_type_ids"] if tti else [])
        torch.onnx.export(Wrap(m, tti), args, f32, input_names=names, output_names=["last_hidden_state"],
            dynamic_axes={n: {0: "b", 1: "s"} for n in names} | {"last_hidden_state": {0: "b", 1: "s"}},
            opset_version=17, dynamo=False)
        del m; gc.collect()
    if not os.path.exists(i8):
        quantize_dynamic(f32, i8, weight_type=QuantType.QInt8)
    return f32, i8

def session(path):
    o = ort.SessionOptions(); o.intra_op_num_threads = 1; o.inter_op_num_threads = 1
    return ort.InferenceSession(path, o, providers=["CPUExecutionProvider"])

def embed(sess, tok, pooling, text):
    e = tok.encode(text)
    names = {i.name for i in sess.get_inputs()}
    feeds = {"input_ids": np.array([e.ids], np.int64), "attention_mask": np.array([e.attention_mask], np.int64)}
    if "token_type_ids" in names: feeds["token_type_ids"] = np.array([e.type_ids], np.int64)
    h = sess.run(None, feeds)[0][0]
    v = h[0] if pooling == "cls" else (h * np.array(e.attention_mask)[:, None]).sum(0) / sum(e.attention_mask)
    return v / np.linalg.norm(v), len(e.ids)

def auc(p, n):
    p, n = np.array(p), np.array(n)
    return float(((p[:, None] > n[None, :]).sum() + 0.5 * (p[:, None] == n[None, :]).sum()) / (len(p) * len(n)))

def evaluate(sess, tok, pooling, wp, lp):
    W = {w: embed(sess, tok, pooling, wp + w)[0] for w in wants}
    L = {x: embed(sess, tok, pooling, lp + x)[0] for x in listings}
    s = {(w, x): float(W[w] @ L[x]) for w in wants for x in listings}
    P = [s[k] for k in pos]; H = [s[k] for k in hard]; E = [v for k, v in s.items() if k not in pos and k not in hard]
    best = (0, 0)
    for t in sorted(set(s.values())):
        tp = sum(v >= t for v in P); fp = sum(v >= t for v in H + E); fn = len(P) - tp
        f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0
        if f1 > best[0]: best = (f1, t)
    p1 = r3 = mrr = 0
    for w in wants:
        ranked = sorted(listings, key=lambda x: -s[(w, x)])
        ps = [x for x in listings if (w, x) in pos]
        p1 += ranked[0] in ps
        r3 += sum(x in ps for x in ranked[:3]) / min(3, len(ps))
        mrr += 1 / (1 + min(ranked.index(x) for x in ps))
    n = len(wants)
    pairs = {f"{w} | {x}": round(s[(w, x)], 3) for w, x in [("Samochód zabawka", "Zabawka - auto mercedes"), ("Samochód zabawka", "Fotelik samochodowy"), ("Klocki", "Klocki LEGO Duplo"), ("Klocki", "Kloc drewniany do rąbania"), ("Narty", "Buty narciarskie"), ("Laptop", "Torba na laptopa"), ("Lalka", "Laleczka szmaciana")]}
    return dict(auc_hard=round(auc(P, H), 3), auc_all=round(auc(P, H + E), 3), best_f1=round(best[0], 3), f1_threshold=round(best[1], 3),
                p_at_1=round(p1 / n, 3), recall_at_3=round(r3 / n, 3), mrr=round(mrr / n, 3),
                pos_mean=round(float(np.mean(P)), 3), hardneg_mean=round(float(np.mean(H)), 3), easyneg_mean=round(float(np.mean(E)), 3), pairs=pairs)

def latency(sess, tok, pooling, texts):
    for t in texts[:5]: embed(sess, tok, pooling, t)
    ts = []
    for _ in range(3):
        for t in texts:
            a = time.perf_counter(); embed(sess, tok, pooling, t); ts.append((time.perf_counter() - a) * 1000)
    return round(float(np.median(ts)), 2), round(float(np.percentile(ts, 95)), 2)

results = {}
proc = psutil.Process()
for name, d, pooling, modes in MODELS:
    if only and name not in only: continue
    mdir = f"{MROOT}/{d}"
    try:
        f32, i8 = export(mdir, f"{OUT}/{name}" + ("-f32" if name.startswith("granite") else ""))
    except Exception as ex:
        results[name] = {"error": repr(ex)[:300]}; print(name, "EXPORT FAIL", repr(ex)[:300], flush=True); continue
    tok = Tokenizer.from_file(f"{mdir}/tokenizer.json"); tok.no_padding(); tok.enable_truncation(512)
    r = {"onnx_fp32_mb": round(os.path.getsize(f32) / 1e6, 1), "onnx_int8_mb": round(os.path.getsize(i8) / 1e6, 1)}
    texts = [modes[next(iter(modes))][1] + x for x in listings] + [modes[next(iter(modes))][0] + w for w in wants]
    r["tokens_mean"] = round(float(np.mean([len(tok.encode(t).ids) for t in texts])), 1)
    for prec, path in (("fp32", f32), ("int8", i8)):
        gc.collect(); rss0 = proc.memory_info().rss
        try:
            sess = session(path); embed(sess, tok, pooling, "test")
        except Exception as ex:
            r[f"{prec}_error"] = repr(ex)[:200]; continue
        r[f"{prec}_rss_delta_mb"] = round((proc.memory_info().rss - rss0) / 1e6, 1)
        r[f"{prec}_latency_ms_median_p95"] = latency(sess, tok, pooling, texts)
        for mode, (wp, lp) in modes.items():
            r[f"{prec}_{mode}"] = evaluate(sess, tok, pooling, wp, lp)
        del sess; gc.collect()
    results[name] = r
    print(name, json.dumps(r, ensure_ascii=False), flush=True)
    json.dump(r, open(f"{OUT}/{name}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(results, open(f"{OUT}/results_{'_'.join(only) if only else 'all'}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
