#!/opt/homebrew/bin/lua

local function fact(n)
	if n == 0 then
		return 0
	elseif n == 1 then
		return 1
	end
	return fact(n - 1) + fact(n - 2)
end

print("Enter a number:")
local a = io.read("*n")
print(fact(a))
