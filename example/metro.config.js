const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the parent directory for the local package source files
config.watchFolders = config.watchFolders || [];
config.watchFolders.push(workspaceRoot);

// Block the parent's node_modules from being processed
config.resolver.blockList = config.resolver.blockList || [];
const parentNodeModules = new RegExp(
  path.resolve(workspaceRoot, 'node_modules').replace(/[/\\]/g, '[/\\\\]') + '.*'
);
if (Array.isArray(config.resolver.blockList)) {
  config.resolver.blockList.push(parentNodeModules);
} else {
  config.resolver.blockList = [config.resolver.blockList, parentNodeModules].filter(Boolean);
}

// Map the local package to the parent directory
config.resolver.extraNodeModules = config.resolver.extraNodeModules || {};
config.resolver.extraNodeModules['@synervoz/edgespeech'] = workspaceRoot;

// Ensure react-native and other deps resolve from example's node_modules
const exampleNodeModules = path.resolve(projectRoot, 'node_modules');
config.resolver.extraNodeModules['react'] = path.resolve(exampleNodeModules, 'react');
config.resolver.extraNodeModules['react-native'] = path.resolve(exampleNodeModules, 'react-native');
config.resolver.extraNodeModules['expo-modules-core'] = path.resolve(exampleNodeModules, 'expo-modules-core');

module.exports = config;
