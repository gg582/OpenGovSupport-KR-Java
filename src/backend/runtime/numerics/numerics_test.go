package numerics

import (
	"math"
	"testing"
)

func TestSum(t *testing.T) {
	cases := []struct {
		in   []float64
		want float64
	}{
		{nil, 0},
		{[]float64{1, 2, 3, 4, 5}, 15},
		{[]float64{1.5, -1.5, 2.0, 2.5}, 4.5},
		{make([]float64, 17), 0}, // tail-loop coverage
	}
	for i, c := range cases {
		got := Sum(c.in)
		if math.Abs(got-c.want) > 1e-9 {
			t.Errorf("case %d: Sum(%v) = %v, want %v", i, c.in, got, c.want)
		}
	}
}

func TestDot(t *testing.T) {
	a := []float64{1, 2, 3, 4, 5}
	b := []float64{2, 2, 2, 2, 2}
	if got := Dot(a, b); math.Abs(got-30) > 1e-9 {
		t.Errorf("Dot = %v, want 30", got)
	}
}

func TestScale(t *testing.T) {
	s := []float64{1, 2, 3, 4, 5, 6, 7}
	Scale(s, 2)
	for i, want := range []float64{2, 4, 6, 8, 10, 12, 14} {
		if s[i] != want {
			t.Errorf("Scale[%d] = %v, want %v", i, s[i], want)
		}
	}
}

func TestMaxFloat(t *testing.T) {
	if got := MaxFloat([]float64{1, -3, 2, 9, 4}); got != 9 {
		t.Errorf("MaxFloat = %v, want 9", got)
	}
	if got := MaxFloat(nil); got != 0 {
		t.Errorf("MaxFloat(nil) = %v, want 0", got)
	}
}

func BenchmarkSum1k(b *testing.B) {
	s := make([]float64, 1024)
	for i := range s {
		s[i] = float64(i)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Sum(s)
	}
}
