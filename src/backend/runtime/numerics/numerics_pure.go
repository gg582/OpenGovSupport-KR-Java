// Portable Go implementations of the numerics kernels.
//
// Loops are manually unrolled by 4 so the Go compiler can auto-vectorise
// on architectures that benefit from it. When a SIMD-aware build is
// added (e.g. numerics_amd64.go with a //go:build amd64 && !purego tag),
// this file gets a complementary //go:build purego || !amd64 guard so
// only one set is linked.
package numerics

func sum(s []float64) float64 {
	var a, b, c, d float64
	i := 0
	for ; i+3 < len(s); i += 4 {
		a += s[i]
		b += s[i+1]
		c += s[i+2]
		d += s[i+3]
	}
	total := a + b + c + d
	for ; i < len(s); i++ {
		total += s[i]
	}
	return total
}

func dot(a, b []float64) float64 {
	var p, q, r, t float64
	i := 0
	for ; i+3 < len(a); i += 4 {
		p += a[i] * b[i]
		q += a[i+1] * b[i+1]
		r += a[i+2] * b[i+2]
		t += a[i+3] * b[i+3]
	}
	total := p + q + r + t
	for ; i < len(a); i++ {
		total += a[i] * b[i]
	}
	return total
}

func scale(s []float64, k float64) {
	i := 0
	for ; i+3 < len(s); i += 4 {
		s[i] *= k
		s[i+1] *= k
		s[i+2] *= k
		s[i+3] *= k
	}
	for ; i < len(s); i++ {
		s[i] *= k
	}
}

func addInPlace(dst, src []float64) {
	i := 0
	for ; i+3 < len(dst); i += 4 {
		dst[i] += src[i]
		dst[i+1] += src[i+1]
		dst[i+2] += src[i+2]
		dst[i+3] += src[i+3]
	}
	for ; i < len(dst); i++ {
		dst[i] += src[i]
	}
}

func sumInts(s []int) int64 {
	var a, b, c, d int64
	i := 0
	for ; i+3 < len(s); i += 4 {
		a += int64(s[i])
		b += int64(s[i+1])
		c += int64(s[i+2])
		d += int64(s[i+3])
	}
	total := a + b + c + d
	for ; i < len(s); i++ {
		total += int64(s[i])
	}
	return total
}

func maxFloat(s []float64) float64 {
	if len(s) == 0 {
		return 0
	}
	m := s[0]
	for i := 1; i < len(s); i++ {
		if s[i] > m {
			m = s[i]
		}
	}
	return m
}
