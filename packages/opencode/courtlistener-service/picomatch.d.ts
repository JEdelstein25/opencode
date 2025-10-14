declare module 'picomatch' {
	function picomatch(glob: string | string[], options?: any): (str: string) => boolean
	export default picomatch
}
