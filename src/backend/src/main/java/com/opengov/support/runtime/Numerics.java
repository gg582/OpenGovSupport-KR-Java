package com.opengov.support.runtime;

/**
 * 벡터/숫자 프리미티브의 공개 표면.
 * Go의 runtime/numerics 패키지를 1:1 대응 — JIT가 알아서 SIMD화할 수 있도록
 * 수동 unrolling을 적용한다. 호출자는 어느 구현이 활성인지 의존해서는 안 된다.
 */
public final class Numerics {

    private Numerics() {}

    /** Sum of s. */
    public static double sum(double[] s) {
        double acc0 = 0, acc1 = 0, acc2 = 0, acc3 = 0;
        int i = 0;
        int n = s.length;
        for (; i + 3 < n; i += 4) {
            acc0 += s[i];
            acc1 += s[i + 1];
            acc2 += s[i + 2];
            acc3 += s[i + 3];
        }
        double total = acc0 + acc1 + acc2 + acc3;
        for (; i < n; i++) total += s[i];
        return total;
    }

    /** Inner product of a and b. */
    public static double dot(double[] a, double[] b) {
        if (a.length != b.length) {
            throw new IllegalArgumentException("numerics: dot length mismatch");
        }
        double acc0 = 0, acc1 = 0, acc2 = 0, acc3 = 0;
        int i = 0;
        int n = a.length;
        for (; i + 3 < n; i += 4) {
            acc0 += a[i] * b[i];
            acc1 += a[i + 1] * b[i + 1];
            acc2 += a[i + 2] * b[i + 2];
            acc3 += a[i + 3] * b[i + 3];
        }
        double total = acc0 + acc1 + acc2 + acc3;
        for (; i < n; i++) total += a[i] * b[i];
        return total;
    }

    /** Multiplies every element of s by k in place. */
    public static void scale(double[] s, double k) {
        int i = 0;
        int n = s.length;
        for (; i + 3 < n; i += 4) {
            s[i] *= k;
            s[i + 1] *= k;
            s[i + 2] *= k;
            s[i + 3] *= k;
        }
        for (; i < n; i++) s[i] *= k;
    }

    /** dst += src elementwise. */
    public static void addInPlace(double[] dst, double[] src) {
        if (dst.length != src.length) {
            throw new IllegalArgumentException("numerics: addInPlace length mismatch");
        }
        int i = 0;
        int n = dst.length;
        for (; i + 3 < n; i += 4) {
            dst[i] += src[i];
            dst[i + 1] += src[i + 1];
            dst[i + 2] += src[i + 2];
            dst[i + 3] += src[i + 3];
        }
        for (; i < n; i++) dst[i] += src[i];
    }

    /** Sum of integer slice as long. */
    public static long sumInts(int[] s) {
        long acc = 0;
        for (int v : s) acc += v;
        return acc;
    }

    /** Largest element of s. Empty s returns 0. */
    public static double maxFloat(double[] s) {
        if (s.length == 0) return 0;
        double m = s[0];
        for (int i = 1; i < s.length; i++) {
            if (s[i] > m) m = s[i];
        }
        return m;
    }

    /** Constrains x to [lo, hi]. */
    public static double clamp(double x, double lo, double hi) {
        if (x < lo) return lo;
        if (x > hi) return hi;
        return x;
    }
}
