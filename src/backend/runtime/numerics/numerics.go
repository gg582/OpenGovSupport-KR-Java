// Package numerics is the public surface for vector/numeric primitives
// used inside the backend. The contract is intentionally narrow so the
// implementation can swap between portable Go and a SIMD/asm path at
// build time without callers caring. Callers MUST NOT depend on which
// implementation is in effect — that is an internal concern.
//
// Build tags determine the active implementation:
//
//	default          numerics_pure.go (manually unrolled, compiler-vectorisable)
//	GOOS/arch SIMD   numerics_<arch>.go + .s files (drop-in)
//
// Add a new SIMD path by writing numerics_amd64.go with a build tag,
// implementing the lowercase "kernel" functions, and linking the .s.
// Public callers continue to use the same exported identifiers.
package numerics

// Sum returns the sum of s.
func Sum(s []float64) float64 { return sum(s) }

// Dot returns the inner product of a and b. Panics if lengths differ.
func Dot(a, b []float64) float64 {
	if len(a) != len(b) {
		panic("numerics: Dot length mismatch")
	}
	return dot(a, b)
}

// Scale multiplies every element of s by k in place.
func Scale(s []float64, k float64) { scale(s, k) }

// AddInPlace performs dst += src elementwise. Panics if lengths differ.
func AddInPlace(dst, src []float64) {
	if len(dst) != len(src) {
		panic("numerics: AddInPlace length mismatch")
	}
	addInPlace(dst, src)
}

// SumInts returns the sum of s as int64.
func SumInts(s []int) int64 { return sumInts(s) }

// MaxFloat returns the largest element of s. Empty s returns 0.
func MaxFloat(s []float64) float64 { return maxFloat(s) }

// Clamp constrains x to [lo, hi].
func Clamp(x, lo, hi float64) float64 {
	if x < lo {
		return lo
	}
	if x > hi {
		return hi
	}
	return x
}
