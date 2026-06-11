# Angular Component Testing with TestBed

**Source**: Context7 (/angular/angular) + Angular official docs (angular.dev)
**Library**: /angular/angular (v20, v21, v22)
**Fetched**: 2026-06-11

## Overview

Angular's `TestBed` provides a powerful testing API for configuring and creating Angular modules for unit testing.

## Vitest Testing (Angular v21+)

Angular CLI now uses **Vitest** by default instead of Karma/Jasmine. Tests run in Node.js with `jsdom`.

```bash
ng test
```

### Configuration

In `angular.json`, configure the test target:

```json
{
  "projects": {
    "your-project-name": {
      "architect": {
        "test": {
          "builder": "@angular/build:unit-test",
          "options": {
            "include": ["**/*.spec.ts"],
            "coverage": true,
            "providersFile": "src/test-providers.ts"
          }
        }
      }
    }
  }
}
```

## ComponentFixture Basics

### Setting Up a Component Test

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyComponent } from './my.component';

describe('MyComponent', () => {
  let component: MyComponent;
  let fixture: ComponentFixture<MyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyComponent], // Standalone component
      // For NgModule-based: declarations: [MyComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(MyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // Trigger change detection
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
```

### Testing DOM Output

```typescript
it('should render title', () => {
  const compiled = fixture.nativeElement as HTMLElement;
  expect(compiled.querySelector('h1')?.textContent).toContain('My App');
});
```

### Using DebugElement and By.css

```typescript
import { By } from '@angular/platform-browser';

it('should display user name', () => {
  component.userName = 'Alice';
  fixture.detectChanges();

  const nameEl = fixture.debugElement.query(By.css('.user-name'));
  expect(nameEl.nativeElement.textContent).toContain('Alice');
});
```

### Testing Component with @Input/@Output

```typescript
@Component({
  standalone: true,
  template: `
    <div class="counter">{{ count }}</div>
    <button (click)="increment.emit()">+</button>
  `
})
class CounterComponent {
  @Input() count = 0;
  @Output() increment = new EventEmitter<void>();
}

describe('CounterComponent', () => {
  it('should display initial count', () => {
    fixture.componentRef.setInput('count', 5);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.counter').textContent).toBe('5');
  });

  it('should emit increment on button click', () => {
    spyOn(component.increment, 'emit');
    const button = fixture.debugElement.query(By.css('button'));
    button.triggerEventHandler('click', null);
    expect(component.increment.emit).toHaveBeenCalled();
  });
});
```

### Async Testing with whenStable

```typescript
it('should load data on init', async () => {
  fixture.detectChanges(); // Triggers ngOnInit
  await fixture.whenStable(); // Wait for async operations
  fixture.detectChanges(); // Update view with loaded data

  expect(fixture.nativeElement.querySelector('.data').textContent).toBe('Loaded');
});
```

### Testing with Host Component

```typescript
@Component({
  standalone: true,
  template: `<app-child [value]="parentValue" (changed)="onChanged($event)"></app-child>`
})
class TestHostComponent {
  parentValue = 'test';
  onChanged(value: string) { /* spy on this */ }
});

describe('ChildComponent with TestHost', () => {
  it('should pass parent value to child', () => {
    const hostFixture = TestBed.createComponent(TestHostComponent);
    hostFixture.detectChanges();

    const childEl = hostFixture.debugElement.query(By.directive(ChildComponent));
    expect(childEl.componentInstance.value).toBe('test');
  });
});
```

### Lifecycle: takeUntilDestroyed Pattern

For operations that might outlive the component:

```typescript
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({ /*...*/ })
export class UserProfile implements OnInit {
  private destroyRef = inject(DestroyRef);

  ngOnInit() {
    interval(5000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.userClient.fetchData();
      });
  }
}
```

## Key Testing APIs

| API | Purpose |
|-----|---------|
| `TestBed.configureTestingModule({})` | Configure test module |
| `TestBed.createComponent(MyComponent)` | Create component fixture |
| `fixture.detectChanges()` | Trigger change detection |
| `fixture.nativeElement` | Raw DOM element access |
| `fixture.debugElement.query(By.css())` | Query with CSS selector |
| `fixture.whenStable()` | Wait for async stability |
| `componentRef.setInput('name', value)` | Set @Input values |
