package com.opengov.support.web.controller;

import com.opengov.support.domain.Feature;
import com.opengov.support.domain.Features;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class SystemController {

    @GetMapping("/features")
    public List<Feature> features() {
        return Features.all();
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }
}
