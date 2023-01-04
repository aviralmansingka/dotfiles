package main

import "fmt"

func main() {
	a := make([]string, 3)
	a[0] = "1"
	a[1] = "1"
	a[2] = "2"
	a = append(a, "Aviral")
	fmt.Println(a)
}
