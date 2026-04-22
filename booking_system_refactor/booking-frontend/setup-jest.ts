import '@testing-library/jest-dom';

// Zone.js testing
import 'zone.js';
import 'zone.js/testing';

// Initialize Angular test environment
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

TestBed.initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
);
