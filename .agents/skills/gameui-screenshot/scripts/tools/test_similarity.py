"""Image similarity batch test - compare 5 images in pairs."""
import os
import numpy as np
from PIL import Image
import imagehash

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)


def phash_distance(img1_path, img2_path):
    """pHash: perceptual hash distance"""
    h1 = imagehash.phash(Image.open(img1_path))
    h2 = imagehash.phash(Image.open(img2_path))
    return int(h1 - h2)


def dhash_distance(img1_path, img2_path):
    """dHash: difference hash distance"""
    h1 = imagehash.dhash(Image.open(img1_path))
    h2 = imagehash.dhash(Image.open(img2_path))
    return int(h1 - h2)


def color_histogram_similarity(img1_path, img2_path):
    """Color histogram correlation (0-1, higher=more similar)"""
    img1 = np.array(Image.open(img1_path).convert("RGB").resize((128, 128)))
    img2 = np.array(Image.open(img2_path).convert("RGB").resize((128, 128)))

    corr_list = []
    for ch in range(3):
        hist1, _ = np.histogram(img1[:, :, ch], bins=32)
        hist2, _ = np.histogram(img2[:, :, ch], bins=32)
        if np.std(hist1) > 0 and np.std(hist2) > 0:
            corr = np.corrcoef(hist1, hist2)[0, 1]
            corr_list.append(corr)

    return float(np.mean(corr_list)) if corr_list else 0.0


def pixel_diff_ratio(img1_path, img2_path):
    """Pixel-level average absolute diff ratio (0-255)"""
    img1 = np.array(Image.open(img1_path).convert("RGB").resize((256, 256)), dtype=np.float64)
    img2 = np.array(Image.open(img2_path).convert("RGB").resize((256, 256)), dtype=np.float64)
    return float(np.mean(np.abs(img1 - img2)))


def main():
    # Test images from project root
    image_files = [
        ("concept_1", os.path.join(PROJECT_ROOT, "concept_1.png")),
        ("concept_2", os.path.join(PROJECT_ROOT, "concept_2.png")),
        ("concept_3", os.path.join(PROJECT_ROOT, "concept_3.png")),
        ("concept_4", os.path.join(PROJECT_ROOT, "concept_4.png")),
        ("concept_5", os.path.join(PROJECT_ROOT, "concept_5.png")),
    ]

    # Verify files exist
    missing = [name for name, path in image_files if not os.path.exists(path)]
    if missing:
        print(f"ERROR: Missing files: {missing}")
        print(f"Project root: {PROJECT_ROOT}")
        return

    n = len(image_files)
    print("=" * 70)
    print(f"Batch Similarity Test: {n} Images")
    print("=" * 70)

    # Pairwise comparison matrix
    results = {}
    for i in range(n):
        name_i, path_i = image_files[i]
        for j in range(i + 1, n):
            name_j, path_j = image_files[j]

            p_dist = phash_distance(path_i, path_j)
            d_dist = dhash_distance(path_i, path_j)
            c_sim = color_histogram_similarity(path_i, path_j)
            px_diff = pixel_diff_ratio(path_i, path_j)

            # Verdict: majority vote
            similar_count = 0
            if p_dist <= 10:
                similar_count += 1
            if d_dist <= 10:
                similar_count += 1
            if c_sim >= 0.9:
                similar_count += 1
            if px_diff < 15.0:
                similar_count += 1

            verdict = "[SIMILAR]" if similar_count >= 3 else "[DIFFERENT]"
            results[(name_i, name_j)] = {
                "phash": p_dist,
                "dhash": d_dist,
                "color_corr": round(c_sim, 3),
                "pixel_diff": round(px_diff, 2),
                "similar_votes": similar_count,
                "verdict": verdict,
            }

    # Print detailed table
    print("\n" + "-" * 70)
    print("Pairwise Comparison Results")
    print("-" * 70)
    print(f"{'Pair':<22} {'pHash':>6} {'dHash':>6} {'Corr':>7} {'PxDiff':>8} {'Verdict':>12}")
    print("-" * 70)

    for (ni, nj), r in sorted(results.items()):
        pair_label = f"{ni} vs {nj}"
        print(
            f"{pair_label:<22} {r['phash']:>6} {r['dhash']:>6} "
            f"{r['color_corr']:>7.3f} {r['pixel_diff']:>7.2f} "
            f"{r['verdict']:>12}"
        )

    # Print similarity groups
    print("\n" + "=" * 70)
    print("Similarity Groups")
    print("=" * 70)

    # Find connected components of similar images
    names = [name for name, _ in image_files]
    parent = {n: n for n in names}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for (ni, nj), r in results.items():
        if r["verdict"] == "[SIMILAR]":
            union(ni, nj)

    groups = {}
    for n in names:
        root = find(n)
        groups.setdefault(root, []).append(n)

    group_id = 1
    for g_root, members in sorted(groups.items(), key=lambda x: -len(x[1])):
        r_key = list(results.keys())[0] if results else None
        if len(members) > 1:
            print(f"\nGroup {group_id}: {' + '.join(members)}")
            # Show intra-group details
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    key = tuple(sorted((members[i], members[j])))
                    if key in results:
                        r = results[key]
                        print(
                            f"   {members[i]} <-> {members[j]}: "
                            f"pHash={r['phash']}, Corr={r['color_corr']}, PxDiff={r['pixel_diff']}"
                        )
            group_id += 1

    unique_groups = [m for m in groups.values() if len(m) == 1]
    if unique_groups:
        print(f"\nUnique (no similar match): {', '.join(g[0] for g in unique_groups)}")

    # Final summary
    print("\n" + "=" * 70)
    print("Summary")
    print("=" * 70)
    total_pairs = len(results)
    similar_pairs = sum(1 for r in results.values() if r["verdict"] == "[SIMILAR]")
    print(f"Total pairs tested: {total_pairs}")
    print(f"Similar pairs:      {similar_pairs}/{total_pairs}")
    print(f"Different pairs:    {total_pairs - similar_pairs}/{total_pairs}")


if __name__ == "__main__":
    main()
