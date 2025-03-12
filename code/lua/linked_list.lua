local list = nil

for line in io.lines() do
	if list == nil then
		list = { value = line }
	else
		list.next = { value = line }
	end
end

-- nil
-- {"aviral", nil}
-- {"aviral", {"mansingka", nil}}

local l = list
while l do
	print(l.value)
	l = l.next
end
