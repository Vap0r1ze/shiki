import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import dts from 'rollup-plugin-dts'
import typescript from 'rollup-plugin-typescript2'
import copy from 'rollup-plugin-copy'
import replace from '@rollup/plugin-replace'
import { terser } from 'rollup-plugin-terser'

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.mjs',
        format: 'esm'
      },
      {
        file: 'dist/index.js',
        format: 'iife',
        name: 'shiki',
        extend: true
      }
    ],
    plugins: [
      replace({
        __BROWSER__: JSON.stringify(true),
        __CDN_ROOT__: ''
      }),
      typescript(),
      nodeResolve(),
      commonjs(),
      terser()
    ]
  },
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.d.ts',
        format: 'es'
      }
    ],
    plugins: [
      dts(),
      copy({
        targets: [{ src: '../../node_modules/vscode-oniguruma/release/onig.wasm', dest: 'dist' }]
      })
    ],
    onwarn: (msg, warn) => {
      if (!/Circular/.test(msg)) {
        warn(msg)
      }
    }
  }
]
