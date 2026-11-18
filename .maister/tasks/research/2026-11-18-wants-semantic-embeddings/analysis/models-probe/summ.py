import json,glob,os,sys
for f in sorted(glob.glob(sys.argv[1]+"/*.json")):
    if os.path.basename(f).startswith("results"): continue
    r=json.load(open(f,encoding="utf-8")); n=os.path.basename(f)[:-5]
    print(f"\n## {n}: fp32 {r['onnx_fp32_mb']}MB int8 {r['onnx_int8_mb']}MB tok={r['tokens_mean']} rss fp32 {r.get('fp32_rss_delta_mb')} int8 {r.get('int8_rss_delta_mb')} lat fp32 {r.get('fp32_latency_ms_median_p95')} int8 {r.get('int8_latency_ms_median_p95')}")
    for k,v in r.items():
        if isinstance(v,dict):
            print(f"  {k:12s} aucH={v['auc_hard']} aucAll={v['auc_all']} F1={v['best_f1']}@{v['f1_threshold']} P@1={v['p_at_1']} R@3={v['recall_at_3']} MRR={v['mrr']} pos={v['pos_mean']} hard={v['hardneg_mean']} easy={v['easyneg_mean']}")
            if k.startswith("fp32"): print("     ", v["pairs"])
