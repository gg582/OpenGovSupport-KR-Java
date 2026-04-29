// To wire up a SIMD/asm path on a particular target, add e.g.:
//
//	//go:build amd64 && !purego
//	// +build amd64,!purego
//	package numerics
//
//	func sum(s []float64) float64 { return sumAVX(s) }
//	// ...
//
// and write the assembly in numerics_amd64.s. Then change numerics_pure.go's
// header to:
//
//	//go:build purego || !amd64
//	// +build purego !amd64
//
// so exactly one implementation is linked. No public API change required.
//
// This package is internal-by-convention — keep all SIMD/asm details here.
package numerics
